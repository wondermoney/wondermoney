import { DI } from '@app/database/di';
import { Portfolio } from '@entity/Portfolio';
import { parseMemberFilter, portfoliosOfMembers } from '@service/household/member-attribution';
import portfolioHoldingsService from '@service/portfolio/portfolio-holdings.service';
import {
  findSnapshotPointOnOrBefore,
  loadCashFlowsInViewerCurrency,
  loadPortfolioSnapshotValues,
  measurePortfolioPeriod,
  type PeriodEnd,
  periodFlowsSince,
  periodReturnSeries,
  periodReturnsOf,
  snapshotSeriesInViewerCurrency,
  utcDay,
} from '@service/portfolio/portfolio-period-performance';

import { toCsv } from './csv';
import type { ReportServiceInput } from './report-filters';

/**
 * One household portfolio's performance over the report period, in the requesting user's currency.
 *
 * - `startValue`: the portfolio's value when the period opens (its latest snapshot on or before
 *   `fromDate`). 0 when it held nothing yet (no snapshot and no trade before `fromDate`); null when
 *   it held something but there is no snapshot to say what it was worth.
 * - `endValue`: the snapshot at `toDate` for a period that has ended, otherwise the live value
 *   (the same figure the portfolio list and dashboards show). Null when a past period has no snapshot.
 * - `netContributions`: money put in minus money taken out: buys (with their fees) minus sales
 *   (net of fees). A portfolio's cash is an asset, so deposits and withdrawals are buys and sales of it.
 *   Each trade is converted at the rate of its date; null when one has no rate into the user's currency.
 * - `dividends`: dividends paid in the period, reported beside the change, not inside it; null when
 *   one has no rate into the user's currency.
 * - `change`: what the market did, `endValue - startValue - netContributions`; null when any of them is.
 * - `changePercent`: `change` as a % of `startValue + netContributions`, when that is positive.
 * - `timeWeightedReturn`: how the investments did (%), each day's return chained, so money put in
 *   or taken out does not move it; dividends count as return. Null when a value or flow is unknown.
 * - `moneyWeightedReturn`: how the investor did (%), the XIRR of the start value, the flows and the
 *   end value; yearly when `moneyWeightedReturnAnnualized` (a period of a year or more), otherwise
 *   over the period itself.
 * - `missingSnapshotDates`: days in the period with no snapshot, whose value was carried over.
 */
export interface PortfolioPerformanceRow {
  change: null | number;
  changePercent: null | number;
  currency: string;
  dividends: null | number;
  endValue: null | number;
  missingSnapshotDates: string[];
  moneyWeightedReturn: null | number;
  moneyWeightedReturnAnnualized: boolean;
  name: string;
  netContributions: null | number;
  portfolioKey: string;
  startValue: null | number;
  timeWeightedReturn: null | number;
}

const CSV_HEADER = [
  'portfolioKey',
  'name',
  'currency',
  'startValue',
  'netContributions',
  'change',
  'changePercent',
  'dividends',
  'endValue',
  'timeWeightedReturn',
  'moneyWeightedReturn',
  'moneyWeightedReturnAnnualized',
  'missingSnapshotDays',
];

/** Mirrors `buildTransactionWhere`'s default window, so an unbounded request stays bounded. */
const REPORT_DEFAULT_WINDOW_MONTHS = 24;

const optionalAmount = (value: null | number) => (value == null ? '' : value.toFixed(2));

export function buildPortfolioPerformanceCsv(rows: PortfolioPerformanceRow[]): string {
  const body = rows.map((row) => [
    row.portfolioKey,
    row.name,
    row.currency,
    optionalAmount(row.startValue),
    optionalAmount(row.netContributions),
    optionalAmount(row.change),
    optionalAmount(row.changePercent),
    optionalAmount(row.dividends),
    optionalAmount(row.endValue),
    optionalAmount(row.timeWeightedReturn),
    optionalAmount(row.moneyWeightedReturn),
    String(row.moneyWeightedReturnAnnualized),
    String(row.missingSnapshotDates.length),
  ]);
  return toCsv(CSV_HEADER, body);
}

export async function getPortfolioPerformanceReport(input: ReportServiceInput, now: Date = new Date()): Promise<PortfolioPerformanceRow[]> {
  const { tenant, user } = input;
  const { fromDate, toDate } = resolvePeriod(input, now);
  const endIsLive = toDate.getTime() >= now.getTime();
  const currency = user.currencyKey.code || 'EUR';

  // Portfolios belong to the household: every one of the tenant's, never another tenant's. A member
  // filter keeps the portfolios those members own; one whose owner left is Shared (`member-attribution.ts`).
  const portfolios = await portfoliosOfMembers(DI.em, tenant.tenantKey, await DI.em.find(
    Portfolio,
    { deletedAt: undefined, tenantKey: { tenantKey: tenant.tenantKey } },
    { orderBy: { name: 'ASC' } },
  ), parseMemberFilter(input.filters.memberKeys));
  if (portfolios.length === 0) return [];

  const portfolioKeys = portfolios.map((portfolio) => portfolio.portfolioKey);
  const liveValues = endIsLive ? await portfolioHoldingsService.getPortfolioValues(user, portfolioKeys, tenant.tenantKey) : null;
  // A start snapshot is the latest on or before the start, so every later one is from its day on.
  const seriesFrom = new Date(`${utcDay(fromDate)}T00:00:00.000Z`);
  const snapshots = await snapshotSeriesInViewerCurrency(
    await loadPortfolioSnapshotValues(portfolioKeys, seriesFrom, tenant.tenantKey),
    currency,
    { from: seriesFrom, to: endIsLive ? now : toDate },
  );

  const rows: PortfolioPerformanceRow[] = [];
  for (const portfolio of portfolios) {
    const recorded = await portfolioHoldingsService.getInvestmentCashFlows(user, tenant.tenantKey, portfolio.portfolioKey);
    const startSnapshot = await findSnapshotPointOnOrBefore(portfolio.portfolioKey, fromDate, currency);
    const flows = await loadCashFlowsInViewerCurrency(recorded, currency, periodFlowsSince(fromDate, startSnapshot));
    const endSnapshot = liveValues ? null : await findSnapshotPointOnOrBefore(portfolio.portfolioKey, toDate, currency);
    const end: PeriodEnd = liveValues
      ? { kind: 'live', value: liveValues.get(portfolio.portfolioKey)?.value ?? 0 }
      : endSnapshot ? { kind: 'snapshot', ...endSnapshot } : { kind: 'unknown', toDate };

    const measure = measurePortfolioPeriod({ end, flows, fromDate, startSnapshot });
    const returns = periodReturnsOf([periodReturnSeries({ end, flows, fromDate, now, snapshots: snapshots.get(portfolio.portfolioKey) ?? [], startSnapshot })]);

    // Nothing held, nothing traded: a portfolio that did not exist yet in this period.
    if (measure.startValue === 0 && measure.endValue === 0 && !measure.hadActivity) continue;

    rows.push({
      change: measure.change,
      changePercent: measure.changePercent,
      currency,
      dividends: measure.dividends,
      endValue: measure.endValue,
      missingSnapshotDates: returns.missingSnapshotDates,
      moneyWeightedReturn: returns.moneyWeighted,
      moneyWeightedReturnAnnualized: returns.moneyWeightedAnnualized,
      name: portfolio.name,
      netContributions: measure.netContributions,
      portfolioKey: String(portfolio.portfolioKey),
      startValue: measure.startValue,
      timeWeightedReturn: returns.timeWeighted,
    });
  }
  return rows;
}

function resolvePeriod(input: ReportServiceInput, now: Date): { fromDate: Date; toDate: Date } {
  const toDate = input.filters.toDate ? new Date(input.filters.toDate) : now;
  if (input.filters.fromDate) return { fromDate: new Date(input.filters.fromDate), toDate };
  const fromDate = new Date(toDate);
  fromDate.setMonth(fromDate.getMonth() - REPORT_DEFAULT_WINDOW_MONTHS);
  return { fromDate, toDate };
}
