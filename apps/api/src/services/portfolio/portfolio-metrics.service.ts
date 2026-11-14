import { sql } from 'kysely';

import { DI } from '@app/app';
import { anyOf, sqlQuery } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { FEED_RATES_ONLY, loadRateTable } from '@service/currency/exchange-rate';
import type { MemberFilter } from '@service/household/member-attribution';

import { historyInViewerCurrency, historyRatePairs, type PortfolioSnapshotValue } from './portfolio-history-currency';
import portfolioHoldingsService from './portfolio-holdings.service';
import { filterValidHoldings } from './portfolio-holdings.utils';
import { aggregatePortfolioKeys } from './portfolio-member-scope';
import {
  calculateMaxDrawdown,
  calculateMoneyWeightedAnnualYield,
  calculateTotalReturn,
  calculateVolatility,
  determineRiskLevel,
  type InvestmentCashFlow,
  MIN_METRICS_HISTORY_SNAPSHOTS,
  type PortfolioValueSnapshot,
} from './portfolio-metrics.utils';
import { loadCashFlowsInViewerCurrency, type PeriodCashFlow, resolveViewerCurrency, utcDay } from './portfolio-period-performance';

type MetricsHistoryStatus = 'empty' | 'insufficient_history' | 'ready';

interface PortfolioMetrics {
  annualYield: null | number;
  assetAllocation: Record<string, number>;
  currentValue: number;
  maxDrawdown: null | number;
  readiness: PortfolioMetricsReadiness;
  riskLevel: 'High' | 'Low' | 'Medium' | null;
  sharpeRatio: null | number;
  totalReturn: number;
  volatility: null | number;
}

interface PortfolioMetricsReadiness {
  allocation: { status: 'ready' };
  holdings: { status: 'ready' };
  performance: { status: MetricsHistoryStatus };
  riskMetrics: { status: 'insufficient_history' | 'ready' };
}

/**
 * Service for calculating portfolio performance metrics
 */
class PortfolioMetricsService {
  /**
   * Calculate total portfolio value from holdings
   */
  private calculateTotalValue(holdings: { currentValue: null | number }[]): number {
    return holdings.reduce((sum, holding) => sum + (holding.currentValue || 0), 0);
  }

  /**
   * Calculate asset allocation breakdown by asset type
   */
  private calculateAssetAllocation(
    holdings: { currentValue: null | number; financialAssetType: string }[],
    totalValue: number,
  ): Record<string, number> {
    if (totalValue === 0) {
      return {};
    }

    return holdings.reduce<Record<string, number>>(
      (acc, holding) => {
        const type = holding.financialAssetType;
        acc[type] ||= 0;
        acc[type] += ((holding.currentValue || 0) / totalValue) * 100;
        return acc;
      },
      {},
    );
  }


  /**
   * Calculate Sharpe Ratio: (annualized return - risk-free rate) / volatility
   * Uses a fixed 4.5% reference rate for every currency, not a live market rate.
   * Both return and volatility always read the whole available history.
   * Every term is an annual percentage — the yield, the rate, and the volatility
   * annualised from calendar-day returns by sqrt(365) — so the ratio is per year.
   * It inherits both minimum-history gates and is null until a year of cash flows
   * and three months of volatility exist.
   */
  private calculateSharpeRatio(annualizedReturn: null | number, volatility: null | number): null | number {
    if (annualizedReturn === null || volatility === null || volatility === 0) return null;
    const riskFreeRate = 4.5; // Default risk-free rate
    return (annualizedReturn - riskFreeRate) / volatility;
  }

  /**
   * The household's daily portfolio value in the viewer's currency, for the risk metrics. Each
   * snapshot is read in the currency it was stored in and converted at the rate in force at the end
   * of its day (see `historyInViewerCurrency`). `complete` is false when a snapshot could not be
   * converted: the series then misses part of a day's value and cannot be measured. `days` counts
   * the days with a snapshot, converted or not.
   */
  private async getPortfolioSnapshots(
    appuser: Appuser,
    viewerCurrency: string,
    fromDate?: Date,
    tenantKey?: number,
    portfolios?: readonly number[],
  ): Promise<{ complete: boolean; days: number; snapshots: PortfolioValueSnapshot[] }> {
    const rows = (await sqlQuery(DI.em)
      .selectFrom('portfolio_snapshot as ps')
      .innerJoin('portfolio as p', 'ps.portfolio_key', 'p.portfolio_key')
      .leftJoin('currency as appuser_c', 'ps.appuser_currency_key', 'appuser_c.currency_key')
      .leftJoin('appuser as owner', 'p.portfolio_owner_appuser_key', 'owner.appuser_key')
      .leftJoin('currency as owner_c', 'owner.currency_key', 'owner_c.currency_key')
      .leftJoin('currency as snapshot_c', 'ps.currency_key', 'snapshot_c.currency_key')
      // The calendar date as text: a `date` column parses to local midnight, which would not line
      // up with the UTC days of the cash flows.
      .select([
        sql<string>`to_char(ps.snapshot_date, 'YYYY-MM-DD')`.as('snapshot_day'),
        sql<null | string>`COALESCE(ps.appuser_currency_total_value, ps.total_value)`.as('total_value'),
        // As `storedSnapshotValue` reads it: a value stored before the owner-currency key was
        // recorded is in the owner's currency.
        sql<null | string>`CASE WHEN ps.appuser_currency_total_value IS NOT NULL THEN COALESCE(appuser_c.code, owner_c.code) ELSE snapshot_c.code END`.as('currency_code'),
      ])
      // Household scope when a tenant is supplied (raw SQL bypasses the filter);
      // else appuser scope (worker path).
      .where((eb) => (tenantKey == null ? eb('p.portfolio_owner_appuser_key', '=', appuser.appuserKey) : eb('p.tenant_key', '=', tenantKey)))
      .where('p.deleted_at', 'is', null)
      .where('ps.deleted_at', 'is', null)
      .$if(Boolean(fromDate), (query) => query.where('ps.snapshot_date', '>=', fromDate))
      .$if(portfolios != null, (query) => query.where(anyOf('p.portfolio_key', portfolios ?? [])))
      .orderBy('ps.snapshot_date', 'asc')
      .execute()) as { currency_code: null | string; snapshot_day: string; total_value: null | number | string }[];

    const stored: PortfolioSnapshotValue[] = rows.map((row) => ({
      currencyCode: row.total_value == null ? null : row.currency_code,
      date: row.snapshot_day,
      value: row.total_value == null ? 0 : Number(row.total_value),
    }));
    const days = new Set(stored.map((snapshot) => snapshot.date)).size;
    const first = stored[0];
    const last = stored.at(-1);
    if (!first || !last) return { complete: true, days, snapshots: [] };
    const window = { from: new Date(`${first.date}T00:00:00Z`), to: new Date(`${last.date}T23:59:59.999Z`) };
    const rates = await loadRateTable(DI.em, historyRatePairs(stored, viewerCurrency), window, FEED_RATES_ONLY);
    const { dataPoints, incompleteDates } = historyInViewerCurrency(stored, viewerCurrency, rates);
    return { complete: incompleteDates.length === 0, days, snapshots: dataPoints.map((point) => ({ day: point.date, totalValue: point.value })) };
  }

  /**
   * The metrics of every household portfolio together, or with `members` of the portfolios those
   * members own (a former member's as Shared): value, allocation, returns and risk alike. A
   * portfolio excluded from the aggregate dashboard is left out (`aggregatePortfolioKeys`).
   */
  async getPortfoliosMetrics(appuser: Appuser, fromDate?: Date, tenantKey?: number, members?: MemberFilter): Promise<{ metrics: PortfolioMetrics }> {
    // The household's portfolios, or those the member filter keeps, less the excluded ones.
    const selected = await aggregatePortfolioKeys(DI.em, tenantKey, members);
    // Get current holdings and their values
    const currentHoldings = await portfolioHoldingsService.getPortfoliosHoldings(appuser, tenantKey, selected);
    const validHoldings = filterValidHoldings(currentHoldings);

    // Calculate total portfolio value
    const totalValue = this.calculateTotalValue(validHoldings);

    // Calculate asset allocation breakdown
    const assetAllocation = this.calculateAssetAllocation(validHoldings, totalValue);

    // Calculate cost basis from holdings for total return
    const costBasis = validHoldings.reduce(
      (sum, h) => sum + h.averageBuyPrice * h.quantity,
      0,
    );

    // Calculate performance metrics
    const totalReturn = calculateTotalReturn(totalValue, costBasis);

    // Every flow in the viewer's currency, at the rate of its date: the live value is in it, and
    // household members record trades in their own currencies. A flow with no rate leaves the
    // metrics that read it unknown.
    const hasInvalidHoldings = currentHoldings.some((holding) => holding.isInvalid);
    const viewerCurrency = await resolveViewerCurrency(appuser);
    const recorded = hasInvalidHoldings ? [] : await portfolioHoldingsService.getInvestmentCashFlows(appuser, tenantKey, selected);
    const cashFlows = await loadCashFlowsInViewerCurrency(recorded, viewerCurrency, new Date(0));

    // Annual yield: money-weighted over every dated buy, sale and dividend, so later
    // contributions do not dilute it the way compounding the cost-basis return did.
    const allFlows = knownFlows(cashFlows);
    const annualYield = hasInvalidHoldings || !allFlows ? null : calculateMoneyWeightedAnnualYield(allFlows, totalValue, new Date());

    // Get portfolio snapshots for risk metrics
    const history = hasInvalidHoldings ? { complete: true, days: 0, snapshots: [] } : await this.getPortfolioSnapshots(appuser, viewerCurrency, fromDate, tenantKey, selected);
    const { snapshots } = history;

    // Calculate risk metrics. They take each day's trades out of its return, so they need every
    // snapshot, and every trade from the first snapshot on, in the viewer's currency.
    const riskFlows = historyCashFlows(history, cashFlows);
    const volatility = riskFlows ? calculateVolatility(snapshots, riskFlows) : null;
    const riskLevel = determineRiskLevel(volatility);
    // Annual yield is all-time, so Sharpe must use all-time volatility too. Keep the selected
    // period for the displayed volatility, risk level and drawdown; reuse it for all-time calls.
    const sharpeHistory = fromDate && annualYield !== null
      ? await this.getPortfolioSnapshots(appuser, viewerCurrency, undefined, tenantKey, selected)
      : history;
    const sharpeFlows = historyCashFlows(sharpeHistory, cashFlows);
    const sharpeVolatility = sharpeHistory === history ? volatility : sharpeFlows ? calculateVolatility(sharpeHistory.snapshots, sharpeFlows) : null;
    const sharpeRatio = this.calculateSharpeRatio(annualYield, sharpeVolatility);
    const maxDrawdown = riskFlows ? calculateMaxDrawdown(snapshots, riskFlows) : null;
    const performanceStatus: MetricsHistoryStatus = history.days === 0 ? 'empty' : history.days < MIN_METRICS_HISTORY_SNAPSHOTS ? 'insufficient_history' : 'ready';

    return {
      metrics: {
        annualYield,
        assetAllocation,
        currentValue: totalValue,
        maxDrawdown,
        readiness: {
          allocation: { status: 'ready' },
          holdings: { status: 'ready' },
          performance: { status: performanceStatus },
          riskMetrics: {
            status: performanceStatus === 'ready' ? 'ready' : 'insufficient_history',
          },
        },
        riskLevel,
        sharpeRatio,
        totalReturn,
        volatility,
      },
    };
  }
}

/** Trades that can be valued for every day of this history, excluding dividend income. */
function historyCashFlows(history: { complete: boolean; snapshots: PortfolioValueSnapshot[] }, cashFlows: PeriodCashFlow[]): InvestmentCashFlow[] | null {
  const firstDay = history.snapshots[0]?.day;
  return history.complete && firstDay ? knownFlows(cashFlows.filter((flow) => flow.kind !== 'DIVIDEND' && utcDay(flow.date) >= firstDay)) : null;
}

/** The flows as `InvestmentCashFlow`s, or null when one has no amount in the viewer's currency. */
function knownFlows(flows: PeriodCashFlow[]): InvestmentCashFlow[] | null {
  const known: InvestmentCashFlow[] = [];
  for (const flow of flows) {
    if (flow.amount == null) return null;
    known.push({ amount: flow.amount, date: flow.date, kind: flow.kind });
  }
  return known;
}

export default new PortfolioMetricsService();
