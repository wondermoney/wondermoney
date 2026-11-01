import { QueryOrder } from '@mikro-orm/core';
import { format } from 'date-fns';
import { sql } from 'kysely';

import { DI } from '@app/app';
import { anyOf, sqlQuery, toDate } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';

import assetPriceService from './asset-price.service';
import { type AssetClassDrift, computeAllocationDrift, generateGuidanceText } from './portfolio-allocation-drift';
import { getPreferredSnapshotTotalValue } from './portfolio-currency.utils';
import { calculateCostBasis, getPeriodStartDate } from './portfolio-dashboard.utils';
import portfolioHoldingsService from './portfolio-holdings.service';
import { filterValidHoldings } from './portfolio-holdings.utils';

export type Period = '1M' | '1Y' | '3M' | '6M' | 'ALL' | 'YTD';
interface AggregateDashboardResponse {
  portfolios: PortfolioBreakdownItem[];
  summary: DashboardSummary;
}
interface AllocationItem {
  percentage: number;
  type: string;
  value: number;
}

interface AllocationResponse {
  byAsset?: AllocationItem[];
  byAssetClass: AllocationItem[];
  bySector?: AllocationItem[];
  byType: AllocationItem[];
  driftRows?: AssetClassDrift[];
  guidanceText?: null | string;
  unclassifiedHoldings: UnclassifiedHolding[];
}

/**
 * Opt-in response additions. Released mobile builds parse the dashboard summary with a strict
 * schema that rejects unknown keys, so a new summary field is only sent to clients that ask.
 */
export interface DashboardOptions {
  includeFeeConversion?: boolean;
}

type BenchmarkStatus = 'missing_benchmark_data' | 'ready' | 'waiting_for_portfolio_history';

interface DashboardSummary {
  assetCount: number;
  currency: string;
  /** Only when the client asked for it (`include=feeConversion`) and at least one fee was left out. */
  feeConversionIncompleteAssetKeys?: number[];
  lastUpdated: string;
  periodLabel: string;
  periodReturn: null | number;
  portfolioCount: number;
  realizedGains: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  totalValue: number;
  unrealizedGains: number;
}

interface IndividualDashboardResponse {
  quickStats: QuickStats;
  summary: Omit<DashboardSummary, 'portfolioCount'>;
}

interface PerformanceDataPoint {
  date: string;
  value: number;
}

interface PerformanceResponse {
  benchmarkDataPoints?: PerformanceDataPoint[];
  benchmarkStatus: BenchmarkStatus;
  benchmarkSymbol?: string;
  dataPoints: PerformanceDataPoint[];
  minDataPointsForComparison: number;
  normalizedBenchmarkDataPoints?: PerformanceDataPoint[];
  normalizedDataPoints?: PerformanceDataPoint[];
  period: string;
  portfolioHistoryStatus: PortfolioHistoryStatus;
  readiness: {
    benchmark: ReadinessStatusMeta<BenchmarkStatus>;
    performance: ReadinessStatusMeta<PortfolioHistoryStatus>;
  };
}

interface PortfolioBreakdownItem {
  currency: string;
  gainPercent: number;
  name: string;
  portfolioKey: number;
  value: number;
  weight: number;
}

type PortfolioHistoryStatus = 'empty' | 'insufficient_history' | 'ready';

interface QuickStats {
  bestPerformer: null | { change: number; ticker: string };
  biggestPosition: null | { ticker: string; weight: number };
  holdingsCount: number;
  worstPerformer: null | { change: number; ticker: string };
}

interface ReadinessStatusMeta<TStatus extends string> {
  status: TStatus;
}

interface TopMover {
  change: number;
  contribution: number;
  logoUrl?: string;
  name: string;
  ticker: string;
}

interface TopMoversResponse {
  gainers: TopMover[];
  losers: TopMover[];
  period: string;
}

interface UnclassifiedHolding {
  name: string;
  value: number;
}

const MIN_TOP_MOVERS_HOLDINGS = 2;

function feeConversionSummary(assetKeys: number[] | undefined, options: DashboardOptions): Pick<DashboardSummary, 'feeConversionIncompleteAssetKeys'> {
  return options.includeFeeConversion && assetKeys?.length ? { feeConversionIncompleteAssetKeys: assetKeys } : {};
}
const MIN_PERFORMANCE_DATA_POINTS = 2;
const DEFAULT_BENCHMARK_SYMBOL = 'SPY';

function filterBenchmarkToPortfolioRange(
  benchmarkPrices: PerformanceDataPoint[],
  dataPoints: PerformanceDataPoint[],
): PerformanceDataPoint[] {
  const firstPortfolioDataPointDate = dataPoints[0]?.date;
  const lastPortfolioDataPointDate = dataPoints.at(-1)?.date;

  return benchmarkPrices.filter(
    (point) =>
      (!firstPortfolioDataPointDate || point.date >= firstPortfolioDataPointDate) &&
      (!lastPortfolioDataPointDate || point.date <= lastPortfolioDataPointDate),
  );
}

function getBenchmarkStatus(
  portfolioStatus: PortfolioHistoryStatus,
  benchmarkDataPoints: PerformanceDataPoint[],
): BenchmarkStatus {
  if (portfolioStatus !== 'ready') return 'waiting_for_portfolio_history';
  return benchmarkDataPoints.length >= MIN_PERFORMANCE_DATA_POINTS ? 'ready' : 'missing_benchmark_data';
}

function getPortfolioHistoryStatus(dataPoints: PerformanceDataPoint[]): PortfolioHistoryStatus {
  if (dataPoints.length === 0) return 'empty';
  if (dataPoints.length < MIN_PERFORMANCE_DATA_POINTS) return 'insufficient_history';
  return 'ready';
}

function normalizeToPercentReturns(dataPoints: PerformanceDataPoint[]): PerformanceDataPoint[] {
  if (!dataPoints.length) return [];
  const firstValue = dataPoints[0]!.value;
  if (firstValue === 0) return dataPoints.map((p) => ({ date: p.date, value: 0 }));
  return dataPoints.map((p) => ({
    date: p.date,
    value: ((p.value - firstValue) / firstValue) * 100,
  }));
}

/**
 * Service for providing portfolio dashboard data
 */
export class PortfolioDashboardService {
  private calculatePeriodReturn(totalValue: number, startSnapshot: number): null | number {
    if (startSnapshot > 0) {
      return ((totalValue - startSnapshot) / startSnapshot) * 100;
    }

    return totalValue > 0 ? null : 0;
  }

  /**
   * Get aggregate dashboard data for all portfolios
   */
  async getAggregateDashboard(appuser: Appuser, period: Period = 'YTD', tenantKey?: number, options: DashboardOptions = {}): Promise<AggregateDashboardResponse> {
    // Get all portfolios
    const portfolios = await DI.em.find(
      Portfolio,
      { deletedAt: undefined, portfolioOwnerAppuserKey: appuser },
      { populate: ['currencyKey'] },
    );

    // Get all holdings across portfolios
    const holdings = await portfolioHoldingsService.getPortfoliosHoldings(appuser, tenantKey);
    const hasInvalidHoldings = holdings.some((holding) => holding.isInvalid);

    // Calculate totals
    const validHoldings = filterValidHoldings(holdings);
    const pricedHoldings = validHoldings.filter((h): h is typeof h & { currentValue: number } => h.currentValue != null);
    const { feeConversionIncompleteAssetKeys, totalCostBasisOfSold, totalRealizedGains } = await portfolioHoldingsService.getRealizedGains(appuser.appuserKey, undefined, tenantKey);
    const totalValue = pricedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
    const costBasis = calculateCostBasis(validHoldings);
    const unrealizedGains = validHoldings.reduce((sum, h) => sum + (h.unrealizedGains || 0), 0);
    const totalGainLoss = unrealizedGains + totalRealizedGains;
    const totalCostBasis = costBasis + totalCostBasisOfSold;
    const totalGainLossPercent = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0;

    // Get period start value from snapshots
    const periodStartDate = getPeriodStartDate(period);
    const startSnapshot = await this.getAggregateValueAtDate(appuser, periodStartDate);
    const periodReturn = hasInvalidHoldings ? null : this.calculatePeriodReturn(totalValue, startSnapshot);

    // Build portfolio breakdown
    const portfolioBreakdown: PortfolioBreakdownItem[] = [];

    for (const portfolio of portfolios) {
      const portfolioHoldings = await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolio.portfolioKey, tenantKey);
      const validPortfolioHoldings = filterValidHoldings(portfolioHoldings);
      const portfolioValue = validPortfolioHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
      const portfolioCostBasis = calculateCostBasis(validPortfolioHoldings);
      const portfolioGain =
        portfolioCostBasis > 0 ? ((portfolioValue - portfolioCostBasis) / portfolioCostBasis) * 100 : 0;

      portfolioBreakdown.push({
        currency: appuser.currencyKey.code || 'EUR',
        gainPercent: portfolioGain,
        name: portfolio.name,
        portfolioKey: portfolio.portfolioKey,
        value: portfolioValue,
        weight: totalValue > 0 ? (portfolioValue / totalValue) * 100 : 0,
      });
    }

    // Get unique asset count
    const uniqueAssets = new Set(validHoldings.map((h) => h.financialAssetKey));

    return {
      portfolios: portfolioBreakdown.toSorted((a, b) => b.value - a.value),
      summary: {
        assetCount: uniqueAssets.size,
        currency: appuser.currencyKey.code || 'EUR',
        ...feeConversionSummary(feeConversionIncompleteAssetKeys, options),
        lastUpdated: new Date().toISOString(),
        periodLabel: period,
        periodReturn,
        portfolioCount: portfolios.length,
        realizedGains: totalRealizedGains,
        totalGainLoss,
        totalGainLossPercent,
        totalValue,
        unrealizedGains,
      },
    };
  }

  /**
   * Get individual portfolio dashboard data
   */
  async getPortfolioDashboard(
    appuser: Appuser,
    portfolioId: number,
    period: Period = 'YTD',
    tenantKey?: number,
    options: DashboardOptions = {},
  ): Promise<IndividualDashboardResponse> {
    // Get portfolio
    const portfolio = await DI.em.findOne(
      Portfolio,
      { deletedAt: undefined, portfolioKey: portfolioId, portfolioOwnerAppuserKey: appuser },
      { populate: ['currencyKey'] },
    );

    if (!portfolio) {
      throw new Error('Portfolio not found');
    }

    // Get holdings
    const holdings = await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolioId, tenantKey);
    const hasInvalidHoldings = holdings.some((holding) => holding.isInvalid);

    // Calculate totals
    const validHoldings = filterValidHoldings(holdings);
    const { feeConversionIncompleteAssetKeys, totalCostBasisOfSold, totalRealizedGains } = await portfolioHoldingsService.getRealizedGains(appuser.appuserKey, portfolioId, tenantKey);
    const totalValue = validHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    const costBasis = calculateCostBasis(validHoldings);
    const unrealizedGains = validHoldings.reduce((sum, h) => sum + (h.unrealizedGains || 0), 0);
    const totalGainLoss = unrealizedGains + totalRealizedGains;
    const totalGainLossPercent = costBasis + totalCostBasisOfSold > 0 ? (totalGainLoss / (costBasis + totalCostBasisOfSold)) * 100 : 0;

    // Get period return
    const periodStartDate = getPeriodStartDate(period);
    const startSnapshot = await this.getPortfolioValueAtDate(portfolioId, periodStartDate);
    const periodReturn = hasInvalidHoldings ? null : this.calculatePeriodReturn(totalValue, startSnapshot);

    // Calculate quick stats
    const sortedByWeight = validHoldings
      .filter((h): h is typeof h & { allocation: number } => h.allocation != null)
      .toSorted((a, b) => b.allocation - a.allocation);
    const sortedByGain = validHoldings
      .filter((h): h is typeof h & { unrealizedGainsPercentage: number } => h.unrealizedGainsPercentage != null)
      .toSorted((a, b) => b.unrealizedGainsPercentage - a.unrealizedGainsPercentage);

    const quickStats: QuickStats = {
      bestPerformer:
        sortedByGain[0]
          ? {
              change: sortedByGain[0].unrealizedGainsPercentage,
              ticker: sortedByGain[0].financialAssetSymbol,
            }
          : null,
      biggestPosition:
        sortedByWeight[0]
          ? { ticker: sortedByWeight[0].financialAssetSymbol, weight: sortedByWeight[0].allocation }
          : null,
      holdingsCount: validHoldings.length,
      worstPerformer: (() => {
        const worst = sortedByGain.at(-1);
        return worst
          ? {
              change: worst.unrealizedGainsPercentage,
              ticker: worst.financialAssetSymbol,
            }
          : null;
      })(),
    };

    return {
      quickStats,
      summary: {
        assetCount: validHoldings.length,
        currency: appuser.currencyKey.code || 'EUR',
        ...feeConversionSummary(feeConversionIncompleteAssetKeys, options),
        lastUpdated: new Date().toISOString(),
        periodLabel: period,
        periodReturn,
        realizedGains: totalRealizedGains,
        totalGainLoss,
        totalGainLossPercent,
        totalValue,
        unrealizedGains,
      },
    };
  }

  /**
   * Get aggregate portfolio value at a specific date
   */
  private async getAggregateValueAtDate(appuser: Appuser, date: Date): Promise<number> {
    const portfolios = await DI.em.find(Portfolio, {
      deletedAt: undefined,
      portfolioOwnerAppuserKey: appuser,
    });

    let totalValue = 0;
    for (const portfolio of portfolios) {
      totalValue += await this.getPortfolioValueAtDate(portfolio.portfolioKey, date);
    }

    return totalValue;
  }

  /**
   * Get portfolio value at a specific date from snapshots
   */
  /**
   * Start-of-period price for MANY assets in one query.
   *
   * One `ORDER BY date DESC LIMIT 1` per holding, issued via `Promise.all`, would mean ~300
   * concurrent queries for ~300 holdings against a connection pool whose default max is 10.
   * `DISTINCT ON` asks for exactly the same rows once, and is
   * served by `financial_asset_price_asset_date_desc_idx`.
   */
  private async getHoldingStartPrices(financialAssetKeys: number[], periodStartDate: Date): Promise<Map<number, number>> {
    const prices = new Map<number, number>();
    const uniqueKeys = [...new Set(financialAssetKeys)];
    if (uniqueKeys.length === 0) return prices;

    const rows = await sqlQuery(DI.em)
      .selectFrom('financial_asset_price')
      .distinctOn('financial_asset_key')
      .select(['financial_asset_key', 'price'])
      .where(anyOf('financial_asset_key', uniqueKeys))
      .where('date', '<=', periodStartDate)
      .orderBy('financial_asset_key')
      .orderBy('date', 'desc')
      .execute();

    for (const row of rows as { financial_asset_key: number; price: null | number | string }[]) {
      if (row.price == null) continue;
      prices.set(row.financial_asset_key, Number(row.price));
    }
    return prices;
  }

  private async getPortfolioValueAtDate(portfolioId: number, date: Date): Promise<number> {
    const snapshot = await DI.em.findOne(
      PortfolioSnapshot,
      {
        portfolioKey: { portfolioKey: portfolioId },
        snapshotDate: { $lte: date },
      },
      { orderBy: { snapshotDate: QueryOrder.DESC } },
    );

    return snapshot ? getPreferredSnapshotTotalValue(snapshot) : 0;
  }

  /**
   * Get performance data for chart
   */
  async getPerformanceData(
    appuser: Appuser,
    portfolioId: null | number,
    period: Period = 'YTD',
    tenantKey?: number,
  ): Promise<PerformanceResponse> {
    const periodStartDate = getPeriodStartDate(period);
    const fromStr = format(periodStartDate, 'yyyy-MM-dd');
    const toStr = format(new Date(), 'yyyy-MM-dd');

    // Determine benchmark symbol
    let benchmarkSymbol = DEFAULT_BENCHMARK_SYMBOL;
    if (portfolioId) {
      const portfolio = await DI.em.findOne(
        Portfolio,
        { deletedAt: undefined, portfolioKey: portfolioId, portfolioOwnerAppuserKey: appuser },
        { populate: ['currencyKey'] },
      );

      if (!portfolio) {
        throw new Error('Portfolio not found');
      }

      if (portfolio.benchmarkSymbol) {
        benchmarkSymbol = portfolio.benchmarkSymbol;
      }
    }

    // Fetch benchmark data in parallel with portfolio data
    const benchmarkPromise = assetPriceService.getBenchmarkHistoricalPrices(benchmarkSymbol, fromStr, toStr);
    const holdings = portfolioId
      ? await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolioId, tenantKey)
      : await portfolioHoldingsService.getPortfoliosHoldings(appuser, tenantKey);

    if (holdings.some((holding) => holding.isInvalid)) {
      const benchmarkPrices = await benchmarkPromise;
      const benchmarkStatus = getBenchmarkStatus('empty', benchmarkPrices);
      return {
        benchmarkDataPoints: benchmarkPrices,
        benchmarkStatus,
        benchmarkSymbol,
        dataPoints: [],
        minDataPointsForComparison: MIN_PERFORMANCE_DATA_POINTS,
        normalizedBenchmarkDataPoints: normalizeToPercentReturns(benchmarkPrices),
        normalizedDataPoints: [],
        period,
        portfolioHistoryStatus: 'empty',
        readiness: {
          benchmark: { status: benchmarkStatus },
          performance: { status: 'empty' },
        },
      };
    }

    if (portfolioId) {
      // Single portfolio - use ORM
      const [snapshots, benchmarkPrices] = await Promise.all([
        DI.em.find(
          PortfolioSnapshot,
          {
            portfolioKey: { portfolioKey: portfolioId },
            snapshotDate: { $gte: periodStartDate },
          },
          { orderBy: { snapshotDate: QueryOrder.ASC } },
        ),
        benchmarkPromise,
      ]);

      const dataPoints: PerformanceDataPoint[] = snapshots.map((s) => ({
        date: format(s.snapshotDate, 'yyyy-MM-dd'),
        value: getPreferredSnapshotTotalValue(s),
      }));
      const portfolioHistoryStatus = getPortfolioHistoryStatus(dataPoints);
      const filteredBenchmarkPrices = filterBenchmarkToPortfolioRange(benchmarkPrices, dataPoints);
      const benchmarkStatus = getBenchmarkStatus(portfolioHistoryStatus, filteredBenchmarkPrices);

      return {
        benchmarkDataPoints: filteredBenchmarkPrices,
        benchmarkStatus,
        benchmarkSymbol,
        dataPoints,
        minDataPointsForComparison: MIN_PERFORMANCE_DATA_POINTS,
        normalizedBenchmarkDataPoints: normalizeToPercentReturns(filteredBenchmarkPrices),
        normalizedDataPoints: normalizeToPercentReturns(dataPoints),
        period,
        portfolioHistoryStatus,
        readiness: {
          benchmark: { status: benchmarkStatus },
          performance: { status: portfolioHistoryStatus },
        },
      };
    } else {
      // Aggregate - need to sum across all portfolios for each date (complex query - use raw SQL)
      const portfolios = await DI.em.find(Portfolio, {
        deletedAt: undefined,
        portfolioOwnerAppuserKey: appuser,
      });

      const portfolioIds = portfolios.map((p) => p.portfolioKey);

      if (portfolioIds.length === 0) {
        const benchmarkPrices = await benchmarkPromise;
        const benchmarkStatus = getBenchmarkStatus('empty', benchmarkPrices);
        return {
          benchmarkDataPoints: benchmarkPrices,
          benchmarkStatus,
          benchmarkSymbol,
          dataPoints: [],
          minDataPointsForComparison: MIN_PERFORMANCE_DATA_POINTS,
          normalizedBenchmarkDataPoints: normalizeToPercentReturns(benchmarkPrices),
          normalizedDataPoints: [],
          period,
          portfolioHistoryStatus: 'empty',
          readiness: {
            benchmark: { status: benchmarkStatus },
            performance: { status: 'empty' },
          },
        };
      }

      const snapshotQuery = sqlQuery(DI.em)
        .selectFrom('portfolio_snapshot as ps')
        .innerJoin('portfolio as p', 'ps.portfolio_key', 'p.portfolio_key')
        .select(['ps.snapshot_date', sql<string>`SUM(COALESCE(ps.appuser_currency_total_value, ps.total_value))`.as('total_value')])
        .where(anyOf('ps.portfolio_key', portfolioIds))
        .where('ps.snapshot_date', '>=', periodStartDate)
        .where('p.deleted_at', 'is', null)
        // Raw SQL bypasses MikroORM's tenant filter; preserve the explicit household scope.
        .$if(tenantKey != null, (query) => query.where('p.tenant_key', '=', tenantKey));

      const [aggregatedSnapshotsRaw, benchmarkPrices] = await Promise.all([
        snapshotQuery.groupBy('ps.snapshot_date').orderBy('ps.snapshot_date', 'asc').execute(),
        benchmarkPromise,
      ]);
      const aggregatedSnapshots = aggregatedSnapshotsRaw as { snapshot_date: Date | string; total_value: string }[];

      const dataPoints: PerformanceDataPoint[] = aggregatedSnapshots.map((s) => ({
        date: format(toDate(s.snapshot_date), 'yyyy-MM-dd'),
        value: s.total_value ? Number(s.total_value) : 0,
      }));
      const portfolioHistoryStatus = getPortfolioHistoryStatus(dataPoints);
      const filteredBenchmarkPrices = filterBenchmarkToPortfolioRange(benchmarkPrices, dataPoints);
      const benchmarkStatus = getBenchmarkStatus(portfolioHistoryStatus, filteredBenchmarkPrices);

      return {
        benchmarkDataPoints: filteredBenchmarkPrices,
        benchmarkStatus,
        benchmarkSymbol,
        dataPoints,
        minDataPointsForComparison: MIN_PERFORMANCE_DATA_POINTS,
        normalizedBenchmarkDataPoints: normalizeToPercentReturns(filteredBenchmarkPrices),
        normalizedDataPoints: normalizeToPercentReturns(dataPoints),
        period,
        portfolioHistoryStatus,
        readiness: {
          benchmark: { status: benchmarkStatus },
          performance: { status: portfolioHistoryStatus },
        },
      };
    }
  }

  /**
   * Get allocation breakdown
   */
  async getAllocation(appuser: Appuser, portfolioId: null | number, tenantKey?: number): Promise<AllocationResponse> {
    const holdings = portfolioId
      ? await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolioId, tenantKey)
      : await portfolioHoldingsService.getPortfoliosHoldings(appuser, tenantKey);
    const validHoldings = filterValidHoldings(holdings);
    const pricedHoldings = validHoldings.filter((h): h is typeof h & { currentValue: number } => h.currentValue != null);

    const totalValue = pricedHoldings.reduce((sum, h) => sum + h.currentValue, 0);

    // Group by asset type
    const byTypeMap = new Map<string, number>();
    for (const holding of pricedHoldings) {
      const type = holding.financialAssetType || 'Other';
      const currentValue = byTypeMap.get(type) || 0;
      byTypeMap.set(type, currentValue + holding.currentValue);
    }

    const byType: AllocationItem[] = Array.from(byTypeMap.entries())
      .map(([type, value]) => ({
        percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
        type,
        value,
      }))
      .toSorted((a, b) => b.value - a.value);

    // Group by individual asset
    const byAsset: AllocationItem[] = pricedHoldings
      .map((h) => ({
        percentage: totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0,
        type: h.financialAssetSymbol,
        value: h.currentValue,
      }))
      .toSorted((a, b) => b.value - a.value);

    // Group by real sector via financial_asset → company → sector join
    const assetKeys = pricedHoldings.map((h) => h.financialAssetKey).filter(Boolean);
    let bySector: AllocationItem[] = [];

    if (assetKeys.length > 0) {
      const sectorRows = await sqlQuery(DI.em)
        .selectFrom('financial_asset as fa')
        .leftJoin('financial_asset_company as fac', 'fa.financial_asset_company_key', 'fac.financial_asset_company_key')
        .leftJoin('financial_asset_sector as fas', 'fac.financial_asset_sector_key', 'fas.financial_asset_sector_key')
        .select(['fa.financial_asset_key', sql<string>`COALESCE(fas.name, 'Other')`.as('sector_name')])
        .where(anyOf('fa.financial_asset_key', assetKeys))
        .execute() as { financial_asset_key: number; sector_name: string }[];

      const sectorMap = new Map<number, string>();
      for (const row of sectorRows) {
        sectorMap.set(row.financial_asset_key, row.sector_name);
      }

      const bySectorMap = new Map<string, number>();
      for (const holding of pricedHoldings) {
        const sectorName = sectorMap.get(holding.financialAssetKey) || 'Other';
        const currentValue = bySectorMap.get(sectorName) || 0;
        bySectorMap.set(sectorName, currentValue + holding.currentValue);
      }

      bySector = Array.from(bySectorMap.entries())
        .map(([type, value]) => ({
          percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
          type,
          value,
        }))
        .toSorted((a, b) => b.value - a.value);
    }

    // Group by asset class via financial_asset → financial_asset_type → asset_class join
    let byAssetClass: AllocationItem[] = [];
    const unclassifiedHoldings: UnclassifiedHolding[] = [];

    if (assetKeys.length > 0) {
      const assetClassRows = (await sqlQuery(DI.em)
        .selectFrom('financial_asset as fa')
        .leftJoin('financial_asset_type as fat', 'fa.financial_asset_type_key', 'fat.financial_asset_type_key')
        .leftJoin('asset_class as ac', 'fat.asset_class_key', 'ac.asset_class_key')
        .select([
          'fa.financial_asset_key',
          'fa.name as asset_name',
          sql<string>`COALESCE(ac.name, 'Unclassified')`.as('asset_class_name'),
        ])
        .where(anyOf('fa.financial_asset_key', assetKeys))
        .execute()) as { asset_class_name: string; asset_name: string; financial_asset_key: number }[];

      const assetClassMap = new Map<number, string>();
      for (const row of assetClassRows) {
        assetClassMap.set(row.financial_asset_key, row.asset_class_name);
      }

      const byAssetClassMap = new Map<string, number>();
      for (const holding of pricedHoldings) {
        const assetClassName = assetClassMap.get(holding.financialAssetKey) || 'Unclassified';
        const currentValue = byAssetClassMap.get(assetClassName) || 0;
        byAssetClassMap.set(assetClassName, currentValue + holding.currentValue);

        if (assetClassName === 'Unclassified') {
          unclassifiedHoldings.push({ name: holding.financialAssetName, value: holding.currentValue });
        }
      }

      byAssetClass = Array.from(byAssetClassMap.entries())
        .map(([type, value]) => ({
          percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
          type,
          value,
        }))
        .toSorted((a, b) => b.value - a.value);
    }

    // Drift + guidance are portfolio-specific (target allocation is stored per-Portfolio)
    let driftRows: AssetClassDrift[] | undefined;
    let guidanceText: null | string | undefined;

    if (portfolioId) {
      const portfolio = await DI.em.findOne(Portfolio, { deletedAt: undefined, portfolioKey: portfolioId });
      if (portfolio?.targetAllocation) {
        const currentByAssetClass = Object.fromEntries(byAssetClass.map((item) => [item.type, item.percentage]));
        driftRows = computeAllocationDrift(currentByAssetClass, portfolio.targetAllocation);
        guidanceText = generateGuidanceText(driftRows);
      }
    }

    return { byAsset, byAssetClass, bySector, byType, driftRows, guidanceText, unclassifiedHoldings };
  }

  /**
   * Get top movers (gainers and losers)
   */
  async getTopMovers(
    appuser: Appuser,
    portfolioId: null | number,
    period: Period = 'YTD',
    limit = 5,
    tenantKey?: number,
  ): Promise<TopMoversResponse> {
    const holdings = portfolioId
      ? await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolioId, tenantKey)
      : await portfolioHoldingsService.getPortfoliosHoldings(appuser, tenantKey);

    const eligibleHoldings = filterValidHoldings(holdings).filter((h) => h.currentValue != null);
    if (eligibleHoldings.length < MIN_TOP_MOVERS_HOLDINGS) {
      return { gainers: [], losers: [], period };
    }

    const periodStartDate = getPeriodStartDate(period);
    const startPrices = await this.getHoldingStartPrices(
      eligibleHoldings.map((holding) => holding.financialAssetKey),
      periodStartDate,
    );
    const movers = eligibleHoldings.map((holding) => {
        const currentValue = holding.currentValue ?? 0;
        const currentPrice = holding.currentPrice ?? null;
        const startPrice = startPrices.get(holding.financialAssetKey) ?? null;

        if (currentPrice == null || startPrice == null || !Number.isFinite(currentPrice) || !Number.isFinite(startPrice) || startPrice <= 0) {
          return {
            change: holding.unrealizedGainsPercentage ?? 0,
            contribution: holding.unrealizedGains ?? 0,
            holding,
          };
        }

        const change = ((currentPrice - startPrice) / startPrice) * 100;
        const contributionFromChange = 100 + change !== 0 ? currentValue * (change / (100 + change)) : null;
        const directContribution = currentValue - holding.quantity * startPrice;

        return {
          change,
          contribution:
            contributionFromChange != null && Number.isFinite(contributionFromChange)
              ? contributionFromChange
              : Number.isFinite(directContribution)
                ? directContribution
                : holding.unrealizedGains ?? 0,
          holding,
        };
    });

    const sortedHoldings = movers.toSorted((a, b) => b.change - a.change);

    const gainers: TopMover[] = sortedHoldings
      .filter((m) => m.change > 0)
      .slice(0, limit)
      .map((m) => ({
        change: m.change,
        contribution: m.contribution,
        logoUrl: m.holding.financialAssetLogoUrl,
        name: m.holding.financialAssetName,
        ticker: m.holding.financialAssetSymbol,
      }));

    const losers: TopMover[] = sortedHoldings
      .filter((m) => m.change < 0)
      .slice(-limit)
      .reverse()
      .map((m) => ({
        change: m.change,
        contribution: m.contribution,
        logoUrl: m.holding.financialAssetLogoUrl,
        name: m.holding.financialAssetName,
        ticker: m.holding.financialAssetSymbol,
      }));

    return { gainers, losers, period };
  }
}

export default new PortfolioDashboardService();
