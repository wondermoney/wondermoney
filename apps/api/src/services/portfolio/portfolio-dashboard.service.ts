import { format } from 'date-fns';
import { sql } from 'kysely';

import { DI } from '@app/app';
import { anyOf, sqlQuery, toDate } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { Portfolio } from '@entity/Portfolio';
import { loadRateTable } from '@service/currency/exchange-rate';
import { sumMoney } from '@utils/money';

import assetPriceService from './asset-price.service';
import { type AssetClassDrift, computeAllocationDrift, generateGuidanceText } from './portfolio-allocation-drift';
import { calculateCostBasis, getPeriodStartDate } from './portfolio-dashboard.utils';
import { historyInViewerCurrency, historyRatePairs, type PortfolioSnapshotValue } from './portfolio-history-currency';
import portfolioHoldingsService from './portfolio-holdings.service';
import { filterValidHoldings } from './portfolio-holdings.utils';
import { combinePeriodMeasures, findSnapshotPointOnOrBefore, loadCashFlowsInViewerCurrency, measurePortfolioPeriod, periodFlowsSince, type PortfolioPeriodMeasure, resolveViewerCurrency } from './portfolio-period-performance';
import { valuePortfolioHoldings } from './portfolio-value';

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

/**
 * Whether every snapshot could be valued in the viewer's currency. A day that left one out
 * (no exchange rate) is listed; its point counts only what could be converted.
 */
interface PerformanceCompleteness {
  currencyCode: string;
  incompleteDates: string[];
  isComplete: boolean;
}

interface PerformanceResponse {
  benchmarkDataPoints?: PerformanceDataPoint[];
  benchmarkStatus: BenchmarkStatus;
  benchmarkSymbol?: string;
  /** Absent only when the history is empty because a holding is invalid. */
  completeness?: PerformanceCompleteness;
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
/**
 * Portfolios belong to the household, so a request (which carries the tenant) sees the
 * partner's portfolios too. Without a tenant (worker paths) this falls back to the owner.
 */
export class PortfolioDashboardService {
  /**
   * One portfolio from the period's start snapshot to its live value; see `measurePortfolioPeriod`.
   * The live value is in the viewer's currency, so the start snapshot and the trades in the period
   * are read in it too.
   */
  private async measurePeriod(appuser: Appuser, portfolioKey: number, periodStartDate: Date, liveValue: number, tenantKey?: number): Promise<PortfolioPeriodMeasure> {
    const viewerCurrency = await resolveViewerCurrency(appuser);
    const [recorded, startSnapshot] = await Promise.all([
      portfolioHoldingsService.getInvestmentCashFlows(appuser, tenantKey, portfolioKey),
      findSnapshotPointOnOrBefore(portfolioKey, periodStartDate, viewerCurrency),
    ]);
    const flows = await loadCashFlowsInViewerCurrency(recorded, viewerCurrency, periodFlowsSince(periodStartDate, startSnapshot));
    return measurePortfolioPeriod({ end: { kind: 'live', value: liveValue }, flows, fromDate: periodStartDate, startSnapshot });
  }

  /**
   * Get aggregate dashboard data for all portfolios
   */
  async getAggregateDashboard(appuser: Appuser, period: Period = 'YTD', tenantKey?: number, options: DashboardOptions = {}): Promise<AggregateDashboardResponse> {
    // Get all portfolios
    const portfolios = await DI.em.find(
      Portfolio,
      { deletedAt: undefined, ...portfolioScope(appuser, tenantKey) },
      { populate: ['currencyKey'] },
    );

    // Get all holdings across portfolios
    const holdings = await portfolioHoldingsService.getPortfoliosHoldings(appuser, tenantKey);
    const hasInvalidHoldings = holdings.some((holding) => holding.isInvalid);

    // Calculate totals
    const validHoldings = filterValidHoldings(holdings);
    const { feeConversionIncompleteAssetKeys, totalCostBasisOfSold, totalRealizedGains } = await portfolioHoldingsService.getRealizedGains(appuser.appuserKey, undefined, tenantKey);
    const costBasis = calculateCostBasis(validHoldings);
    const unrealizedGains = validHoldings.reduce((sum, h) => sum + (h.unrealizedGains || 0), 0);
    const totalGainLoss = unrealizedGains + totalRealizedGains;
    const totalCostBasis = costBasis + totalCostBasisOfSold;
    const totalGainLossPercent = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0;

    // Build portfolio breakdown. Each portfolio is valued as the portfolio list and net worth
    // value it, and the total is their sum, so every surface shows the same figures.
    const portfolioBreakdown: Omit<PortfolioBreakdownItem, 'weight'>[] = [];
    const periodStartDate = getPeriodStartDate(period);
    const periodMeasures: PortfolioPeriodMeasure[] = [];

    for (const portfolio of portfolios) {
      const portfolioHoldings = await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolio.portfolioKey, tenantKey);
      const validPortfolioHoldings = filterValidHoldings(portfolioHoldings);
      const portfolioValue = valuePortfolioHoldings(portfolioHoldings).value;
      const portfolioCostBasis = calculateCostBasis(validPortfolioHoldings);
      const portfolioGain =
        portfolioCostBasis > 0 ? ((portfolioValue - portfolioCostBasis) / portfolioCostBasis) * 100 : 0;

      periodMeasures.push(await this.measurePeriod(appuser, portfolio.portfolioKey, periodStartDate, portfolioValue, tenantKey));

      portfolioBreakdown.push({
        currency: appuser.currencyKey.code || 'EUR',
        gainPercent: portfolioGain,
        name: portfolio.name,
        portfolioKey: portfolio.portfolioKey,
        value: portfolioValue,
      });
    }
    const totalValue = sumMoney(portfolioBreakdown.map((item) => item.value));

    // Net of the money put in during the period, so new contributions are not counted as return.
    const periodReturn = hasInvalidHoldings ? null : combinePeriodMeasures(periodMeasures).changePercent;

    // Get unique asset count
    const uniqueAssets = new Set(validHoldings.map((h) => h.financialAssetKey));

    return {
      portfolios: portfolioBreakdown
        .map((item) => ({ ...item, weight: totalValue > 0 ? (item.value / totalValue) * 100 : 0 }))
        .toSorted((a, b) => b.value - a.value),
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
      { deletedAt: undefined, portfolioKey: portfolioId, ...portfolioScope(appuser, tenantKey) },
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
    const totalValue = valuePortfolioHoldings(holdings).value;
    const costBasis = calculateCostBasis(validHoldings);
    const unrealizedGains = validHoldings.reduce((sum, h) => sum + (h.unrealizedGains || 0), 0);
    const totalGainLoss = unrealizedGains + totalRealizedGains;
    const totalGainLossPercent = costBasis + totalCostBasisOfSold > 0 ? (totalGainLoss / (costBasis + totalCostBasisOfSold)) * 100 : 0;

    // Period return, net of the money put in during the period
    const periodStartDate = getPeriodStartDate(period);
    const periodReturn = hasInvalidHoldings
      ? null
      : (await this.measurePeriod(appuser, portfolioId, periodStartDate, totalValue, tenantKey)).changePercent;

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
        { deletedAt: undefined, portfolioKey: portfolioId, ...portfolioScope(appuser, tenantKey) },
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

    // A single portfolio was found (and scoped) above; the aggregate is every household portfolio.
    const portfolioIds = portfolioId
      ? [portfolioId]
      : (await DI.em.find(Portfolio, { deletedAt: undefined, ...portfolioScope(appuser, tenantKey) })).map((p) => p.portfolioKey);

    const [history, benchmarkPrices] = await Promise.all([
      this.loadHistoryInViewerCurrency(appuser, portfolioIds, periodStartDate, tenantKey),
      benchmarkPromise,
    ]);
    const { completeness, dataPoints } = history;
    const portfolioHistoryStatus = getPortfolioHistoryStatus(dataPoints);
    const filteredBenchmarkPrices = filterBenchmarkToPortfolioRange(benchmarkPrices, dataPoints);
    const benchmarkStatus = getBenchmarkStatus(portfolioHistoryStatus, filteredBenchmarkPrices);

    return {
      benchmarkDataPoints: filteredBenchmarkPrices,
      benchmarkStatus,
      benchmarkSymbol,
      completeness,
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

  /**
   * The portfolios' daily history in the viewer's currency. Each snapshot is read in the currency
   * it was stored in (its owner's, or the portfolio's when no owner-currency value was stored) and
   * converted at its day's rate; see `historyInViewerCurrency`.
   */
  private async loadHistoryInViewerCurrency(appuser: Appuser, portfolioIds: number[], periodStartDate: Date, tenantKey?: number): Promise<{ completeness: PerformanceCompleteness; dataPoints: PerformanceDataPoint[] }> {
    const viewerCurrency = await resolveViewerCurrency(appuser);
    if (portfolioIds.length === 0) return { completeness: { currencyCode: viewerCurrency, incompleteDates: [], isComplete: true }, dataPoints: [] };

    const rows = await sqlQuery(DI.em)
      .selectFrom('portfolio_snapshot as ps')
      .innerJoin('portfolio as p', 'ps.portfolio_key', 'p.portfolio_key')
      .leftJoin('currency as appuser_c', 'ps.appuser_currency_key', 'appuser_c.currency_key')
      .leftJoin('appuser as owner', 'p.portfolio_owner_appuser_key', 'owner.appuser_key')
      .leftJoin('currency as owner_c', 'owner.currency_key', 'owner_c.currency_key')
      .leftJoin('currency as snapshot_c', 'ps.currency_key', 'snapshot_c.currency_key')
      .select([
        'ps.snapshot_date',
        sql<null | string>`COALESCE(ps.appuser_currency_total_value, ps.total_value)`.as('value'),
        // A value stored before the owner-currency key was recorded is in the owner's currency.
        sql<null | string>`CASE WHEN ps.appuser_currency_total_value IS NOT NULL THEN COALESCE(appuser_c.code, owner_c.code) ELSE snapshot_c.code END`.as('currency_code'),
      ])
      .where(anyOf('ps.portfolio_key', portfolioIds))
      .where('ps.snapshot_date', '>=', periodStartDate)
      .where('ps.deleted_at', 'is', null)
      .where('p.deleted_at', 'is', null)
      // Raw SQL bypasses MikroORM's tenant filter; preserve the explicit household scope.
      .$if(tenantKey != null, (query) => query.where('p.tenant_key', '=', tenantKey))
      .orderBy('ps.snapshot_date', 'asc')
      .execute() as { currency_code: null | string; snapshot_date: Date | string; value: null | number | string }[];

    const snapshots: PortfolioSnapshotValue[] = rows.map((row) => ({
      currencyCode: row.value == null ? null : row.currency_code,
      date: format(toDate(row.snapshot_date), 'yyyy-MM-dd'),
      value: row.value == null ? 0 : Number(row.value),
    }));
    const rates = await loadRateTable(DI.em, historyRatePairs(snapshots, viewerCurrency), { from: periodStartDate, to: new Date() });
    const { dataPoints, incompleteDates } = historyInViewerCurrency(snapshots, viewerCurrency, rates);
    return { completeness: { currencyCode: viewerCurrency, incompleteDates, isComplete: incompleteDates.length === 0 }, dataPoints };
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

function portfolioScope(appuser: Appuser, tenantKey?: number): { portfolioOwnerAppuserKey: Appuser } | { tenantKey: { tenantKey: number } } {
  return tenantKey == null ? { portfolioOwnerAppuserKey: appuser } : { tenantKey: { tenantKey } };
}

export default new PortfolioDashboardService();
