import { QueryOrder } from '@mikro-orm/core';
import { differenceInDays } from 'date-fns';

import { DI } from '@app/app';
import type { Appuser } from '@entity/Appuser';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { InternalServerError } from '@utils/errors';

import portfolioHoldingsService from './portfolio-holdings.service';
import { filterValidHoldings } from './portfolio-holdings.utils';
import {
  calculateAnnualizedYield,
  calculateTotalReturn,
  calculateVolatility,
  determineRiskLevel,
  MIN_METRICS_HISTORY_SNAPSHOTS,
} from './portfolio-metrics.utils';

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
   * Uses a default risk-free rate of 4.5% (approximate US treasury rate)
   */
  private calculateSharpeRatio(annualizedReturn: null | number, volatility: null | number): null | number {
    if (annualizedReturn === null || volatility === null || volatility === 0) return null;
    const riskFreeRate = 4.5; // Default risk-free rate
    return (annualizedReturn - riskFreeRate) / volatility;
  }

  /**
   * Calculate Maximum Drawdown from portfolio snapshot values
   * Max drawdown = largest peak-to-trough decline as a percentage
   */
  private calculateMaxDrawdown(snapshots: { totalValue: number }[]): null | number {
    if (snapshots.length < MIN_METRICS_HISTORY_SNAPSHOTS) return null;

    let peak = snapshots[0]!.totalValue;
    let maxDrawdown = 0;

    for (const snapshot of snapshots) {
      if (snapshot.totalValue > peak) peak = snapshot.totalValue;
      const drawdown = peak > 0 ? ((peak - snapshot.totalValue) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return maxDrawdown;
  }

  /**
   * Get the start date for metrics calculation
   */
  private async getStartDate(_appuser: Appuser): Promise<Date | undefined> {
    const buyTransactionType = await DI.em.findOne(FinancialTransactionType, {
      name: 'BUY',
    });

    if (!buyTransactionType) {
      throw new InternalServerError('BUY transaction type not found');
    }

    const firstTransaction = await DI.em.findOne(
      FinancialTransaction,
      {
        financialTransactionTypeKey: buyTransactionType,
      },
      { orderBy: { transactionDate: QueryOrder.ASC } },
    );

    return firstTransaction?.transactionDate;
  }

  /**
   * Get portfolio snapshots for risk metric calculations
   */
  private async getPortfolioSnapshots(
    appuser: Appuser,
    fromDate?: Date,
    tenantKey?: number,
  ): Promise<{ totalValue: number }[]> {
    const knex = DI.em.getKnex();

    const query = knex('portfolio_snapshot as ps')
      .select(knex.raw('ps.snapshot_date, SUM(COALESCE(ps.appuser_currency_total_value, ps.total_value)) as total_value'))
      .innerJoin('portfolio as p', 'ps.portfolio_key', 'p.portfolio_key')
      // RAD-343: household scope when a tenant is supplied (raw SQL bypasses the filter);
      // else appuser scope (worker path).
      .where(function () {
        if (tenantKey == null) this.where('p.portfolio_owner_appuser_key', appuser.appuserKey);
        else this.where('p.tenant_key', tenantKey);
      })
      .whereNull('p.deleted_at')
      .groupBy('ps.snapshot_date')
      .orderBy('ps.snapshot_date', 'asc');

    if (fromDate) {
      query.where('ps.snapshot_date', '>=', fromDate);
    }

    const rows = (await query) as { snapshot_date: Date; total_value: string }[];
    return rows.map((r) => ({ totalValue: Number(r.total_value) }));
  }

  /**
   * Get comprehensive portfolio metrics
   */
  async getPortfoliosMetrics(appuser: Appuser, fromDate?: Date, tenantKey?: number): Promise<{ metrics: PortfolioMetrics }> {
    // Get current holdings and their values
    const currentHoldings = await portfolioHoldingsService.getPortfoliosHoldings(appuser, tenantKey);
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

    // Calculate annualized yield
    const hasInvalidHoldings = currentHoldings.some((holding) => holding.isInvalid);
    const startDate = hasInvalidHoldings ? null : await this.getStartDate(appuser);
    const daysHeld = startDate ? differenceInDays(new Date(), startDate) : 0;
    const annualYield = hasInvalidHoldings ? null : calculateAnnualizedYield(totalReturn, daysHeld);

    // Get portfolio snapshots for risk metrics
    const snapshots = hasInvalidHoldings ? [] : await this.getPortfolioSnapshots(appuser, fromDate, tenantKey);

    // Calculate risk metrics
    const volatility = calculateVolatility(snapshots);
    const riskLevel = determineRiskLevel(volatility);
    const sharpeRatio = this.calculateSharpeRatio(annualYield, volatility);
    const maxDrawdown = this.calculateMaxDrawdown(snapshots);
    const performanceStatus: MetricsHistoryStatus = snapshots.length === 0 ? 'empty' : snapshots.length < MIN_METRICS_HISTORY_SNAPSHOTS ? 'insufficient_history' : 'ready';

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

export default new PortfolioMetricsService();
