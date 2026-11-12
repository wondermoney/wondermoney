import { startOfYear, subDays, subMonths } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

const portfolioHoldingsServiceMock = vi.hoisted(() => ({
  getInvestmentCashFlows: vi.fn().mockResolvedValue([]),
  getPortfolioHoldings: vi.fn(),
  getPortfoliosHoldings: vi.fn(),
  getRealizedGains: vi.fn(),
}));
const assetPriceServiceMock = vi.hoisted(() => ({
  ensureRecentAssetPrice: vi.fn(),
  getBenchmarkHistoricalPrices: vi.fn(),
  getPricesAsOf: vi.fn(),
}));
vi.mock('../financial-asset.service', () => ({ resolveOrCreateFinancialAsset: vi.fn() }));
const snapshotServiceMock = vi.hoisted(() => ({
  backfillSnapshotsForPortfolio: vi.fn(),
}));

vi.mock('@app/app', () => ({ DI: { em: {} } }));
// The period measure reads snapshots through the database module: the same mocked `DI`.
vi.mock('@app/database/di', async () => ({ DI: (await import('@app/app')).DI }));
vi.mock('../portfolio-holdings.service', () => ({ default: portfolioHoldingsServiceMock }));
vi.mock('../asset-price.service', () => ({ default: assetPriceServiceMock }));
vi.mock('../portfolio-snapshot.service', () => ({ default: snapshotServiceMock }));

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { DI } from '@app/app';
import type { Appuser } from '@entity/Appuser';

import { getPreferredSnapshotTotalValue } from '../portfolio-currency.utils';
import { type Period, PortfolioDashboardService } from '../portfolio-dashboard.service';
import { calculateCostBasis, getPeriodStartDate } from '../portfolio-dashboard.utils';
import portfolioTransactionService from '../portfolio-transaction.service';

/** `getKysely` for a database that answers every query with `rows`. */
const databaseReturning = (rows: unknown[]) => vi.fn(() => kyselyDouble(() => rows).db);

/** `findOne` that finds the portfolio itself and no period-start snapshot. */
const portfolioWithoutSnapshots = (portfolio: Record<string, unknown>) =>
  vi.fn(async (_entity: unknown, where: { portfolioKey?: unknown }) => (typeof where.portfolioKey === 'number' ? portfolio : null));

describe('portfolio dashboard service', () => {
  const service = new PortfolioDashboardService();
  const appuser = { appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser;
  function setupDashboardMocks() {
    Object.assign(DI.em, {
      find: vi.fn().mockResolvedValue([{ name: 'Main', portfolioKey: 1 }]),
      findOne: vi.fn(),
    });
    portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([
      {
        allocation: 100,
        currentValue: 280.42,
        financialAssetSymbol: 'AAPL',
        unrealizedGains: 190.42,
        unrealizedGainsPercentage: 211.58,
      },
    ]);
    portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
      {
        currentValue: 280.42,
        financialAssetKey: 1,
        unrealizedGains: 190.42,
      },
    ]);
    portfolioHoldingsServiceMock.getRealizedGains.mockResolvedValue({ totalCostBasisOfSold: 0, totalRealizedGains: 0 });
    assetPriceServiceMock.getBenchmarkHistoricalPrices.mockResolvedValue([
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 101 },
    ]);
  }

  describe('getPeriodStartDate', () => {
    it('returns 1 month ago for 1M', () => {
      const result = getPeriodStartDate('1M');
      const expected = subMonths(new Date(), 1);
      expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
    });

    it('returns start of year for YTD', () => {
      const result = getPeriodStartDate('YTD');
      const expected = startOfYear(new Date());
      expect(result.getTime()).toBe(expected.getTime());
    });

    it('uses firstTransactionDate for ALL when provided', () => {
      const firstDate = new Date('2020-01-01');
      const result = getPeriodStartDate('ALL', firstDate);
      expect(result).toEqual(firstDate);
    });

    it('defaults to 10 years ago for ALL without firstTransactionDate', () => {
      const result = getPeriodStartDate('ALL');
      const tenYearsAgo = subDays(new Date(), 365 * 10);
      expect(Math.abs(result.getTime() - tenYearsAgo.getTime())).toBeLessThan(1000);
    });

    it('defaults to YTD for unknown period', () => {
      const result = getPeriodStartDate('UNKNOWN' as Period);
      const expected = startOfYear(new Date());
      expect(result.getTime()).toBe(expected.getTime());
    });
  });

  describe('calculateCostBasis', () => {
    it('calculates cost basis from holdings', () => {
      const holdings = [
        { averageBuyPrice: 100, quantity: 10 },
        { averageBuyPrice: 50, quantity: 20 },
      ];
      expect(calculateCostBasis(holdings)).toBe(2000); // 1000 + 1000
    });

    it('returns 0 for empty holdings', () => {
      expect(calculateCostBasis([])).toBe(0);
    });
  });

  describe('snapshot currency preference', () => {
    it('prefers appuser snapshot value for aggregate reads', () => {
      expect(
        getPreferredSnapshotTotalValue({
          appuserCurrencyTotalValue: 106,
          totalValue: 100,
        }),
      ).toBe(106);
    });
  });

  describe('period return semantics', () => {
    it('returns null period return when there is value but no baseline snapshot', async () => {
      setupDashboardMocks();
      const findOneMock = vi.fn();
      Object.assign(DI.em, { find: vi.fn().mockResolvedValue([{ name: 'Main', portfolioKey: 1 }]), findOne: findOneMock });
      findOneMock.mockResolvedValueOnce({ name: 'Main', portfolioKey: 1 });
      findOneMock.mockResolvedValueOnce(null);

      const result = await service.getPortfolioDashboard(appuser, 1, 'YTD');

      expect(result.summary.periodReturn).toBeNull();
    });

    it('returns null aggregate period return when there is value but no baseline snapshot', async () => {
      setupDashboardMocks();
      const findOneMock = vi.fn().mockResolvedValue(null);
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ name: 'Main', portfolioKey: 1 }]),
        findOne: findOneMock,
      });

      const result = await service.getAggregateDashboard(appuser, 'YTD');

      expect(result.summary.periodReturn).toBeNull();
    });
  });

  describe('period return excludes money put in during the period', () => {
    const yearStart = getPeriodStartDate('YTD');
    const day = (offset: number) => new Date(yearStart.getTime() + offset * 86_400_000);
    // Three monthly buys of €1,000 into a portfolio worth €10,000 when the year opened.
    const monthlyBuys = [5, 35, 65].map((offset) => ({ amount: -1000, currencyCode: 'EUR', date: day(offset), kind: 'BUY' as const }));
    const holdingWorth = (currentValue: number) => [
      { allocation: 100, currentValue, financialAssetKey: 1, financialAssetSymbol: 'VWCE', unrealizedGains: 0, unrealizedGainsPercentage: 0 },
    ];

    function setupYear(currentValue: number) {
      setupDashboardMocks();
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue(holdingWorth(currentValue));
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue(holdingWorth(currentValue));
      portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue(monthlyBuys);
      const yearOpenSnapshot = { appuserCurrencyKey: { code: 'EUR' }, appuserCurrencyTotalValue: 10000, portfolioKey: { portfolioKey: 7, portfolioOwnerAppuserKey: { currencyKey: { code: 'EUR' } } }, snapshotDate: day(-1), totalValue: 10000 };
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ name: 'Long-term', portfolioKey: 7 }]),
        findOne: vi.fn(async (_entity: unknown, where: { portfolioKey?: unknown }) =>
          typeof where.portfolioKey === 'number' ? { name: 'Long-term', portfolioKey: 7 } : yearOpenSnapshot),
      });
    }

    it('shows no return on a portfolio whose growth is only new money', async () => {
      setupYear(13000);

      const single = await service.getPortfolioDashboard(appuser, 7, 'YTD');
      const aggregate = await service.getAggregateDashboard(appuser, 'YTD');

      expect(single.summary.periodReturn).toBe(0);
      expect(aggregate.summary.periodReturn).toBe(0);
    });

    it('measures the market move against what was held plus what was put in', async () => {
      setupYear(13650);

      const single = await service.getPortfolioDashboard(appuser, 7, 'YTD');
      const aggregate = await service.getAggregateDashboard(appuser, 'YTD');

      expect(single.summary.periodReturn).toBe(5);
      expect(aggregate.summary.periodReturn).toBe(5);
    });

    describe('with the buys recorded in dollars by a household member', () => {
      // Each $2,000 buy is €1,000 at 0.5, so the euro figures above still hold once converted.
      const dollarBuys = monthlyBuys.map((flow) => ({ ...flow, amount: -2000, currencyCode: 'USD' }));

      function setupDollarYear(currentValue: number, rate: null | number) {
        setupYear(currentValue);
        portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue(dollarBuys);
        const { find, findOne } = DI.em as unknown as { find: (...args: unknown[]) => unknown; findOne: (...args: unknown[]) => unknown };
        const isRate = (entity: unknown) => (entity as undefined | { name?: string })?.name === 'ExchangeRate';
        Object.assign(DI.em, {
          find: vi.fn((entity: unknown, ...rest: unknown[]) => (isRate(entity) ? Promise.resolve(rate == null ? [] : [{ date: day(-30), rate }]) : find(entity, ...rest))),
          findOne: vi.fn((entity: unknown, ...rest: unknown[]) => (isRate(entity) ? Promise.resolve(null) : findOne(entity, ...rest))),
        });
      }

      it('converts them into the viewer\'s currency at their dates', async () => {
        setupDollarYear(13650, 0.5);

        const single = await service.getPortfolioDashboard(appuser, 7, 'YTD');

        expect(single.summary.periodReturn).toBe(5);
      });

      it('has no return when no rate converts them, never adding dollars to euros', async () => {
        setupDollarYear(13650, null);

        const single = await service.getPortfolioDashboard(appuser, 7, 'YTD');
        const aggregate = await service.getAggregateDashboard(appuser, 'YTD');

        expect(single.summary.periodReturn).toBeNull();
        expect(aggregate.summary.periodReturn).toBeNull();
      });
    });
  });

  describe('household portfolios', () => {
    it('counts and values every portfolio in the household, the partner\'s included', async () => {
      setupDashboardMocks();
      const find = vi.fn().mockResolvedValue([
        { name: 'Long-term', portfolioKey: 7 },
        { name: 'Tech picks', portfolioKey: 8 },
      ]);
      Object.assign(DI.em, { find, findOne: vi.fn().mockResolvedValue(null) });
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockImplementation((_appuser: Appuser, portfolioKey: number) => Promise.resolve(
        portfolioKey === 7
          ? [{ currentValue: 12535.86, financialAssetKey: 1 }]
          : [{ currentValue: 2453.28, financialAssetKey: 2 }],
      ));

      const result = await service.getAggregateDashboard(appuser, 'YTD', 42);

      expect(find.mock.calls[0]?.[1]).toEqual({ deletedAt: undefined, tenantKey: { tenantKey: 42 } });
      expect(result.summary.portfolioCount).toBe(2);
      expect(result.summary.totalValue).toBe(14989.14);
      expect(result.portfolios.map((portfolio) => [portfolio.portfolioKey, portfolio.value])).toEqual([[7, 12535.86], [8, 2453.28]]);
    });

    it('opens a portfolio another household member owns', async () => {
      setupDashboardMocks();
      const findOne = vi.fn().mockResolvedValueOnce({ name: 'Tech picks', portfolioKey: 8 }).mockResolvedValue(null);
      Object.assign(DI.em, { find: vi.fn().mockResolvedValue([]), findOne });

      const result = await service.getPortfolioDashboard(appuser, 8, 'YTD', 42);

      expect(findOne.mock.calls[0]?.[1]).toEqual({ deletedAt: undefined, portfolioKey: 8, tenantKey: { tenantKey: 42 } });
      expect(result.summary.totalValue).toBe(280.42);
    });
  });

  describe('gain/loss composition', () => {
    it('includes realized gains in aggregate totalGainLoss while keeping unrealized gains separate', async () => {
      setupDashboardMocks();
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        {
          averageBuyPrice: 100,
          currentValue: 127,
          financialAssetKey: 1,
          quantity: 1,
          unrealizedGains: 27,
        },
      ]);
      portfolioHoldingsServiceMock.getRealizedGains.mockResolvedValue({ totalCostBasisOfSold: 100, totalRealizedGains: 64 });

      const result = await service.getAggregateDashboard(appuser, 'YTD');

      expect(result.summary.unrealizedGains).toBe(27);
      expect(result.summary.realizedGains).toBe(64);
      expect(result.summary.totalGainLoss).toBe(91);
      expect(result.summary.totalGainLossPercent).toBe(45.5);
    });

    it('includes realized gains in individual totalGainLoss while keeping unrealized gains separate', async () => {
      setupDashboardMocks();
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ name: 'Main', portfolioKey: 1 }]),
        findOne: portfolioWithoutSnapshots({ name: 'Main', portfolioKey: 1 }),
      });
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([
        {
          allocation: 100,
          averageBuyPrice: 100,
          currentValue: 127,
          financialAssetSymbol: 'AAPL',
          quantity: 1,
          unrealizedGains: 27,
          unrealizedGainsPercentage: 27,
        },
      ]);
      portfolioHoldingsServiceMock.getRealizedGains.mockResolvedValue({ totalCostBasisOfSold: 100, totalRealizedGains: 64 });

      const result = await service.getPortfolioDashboard(appuser, 1, 'YTD');

      expect(result.summary.unrealizedGains).toBe(27);
      expect(result.summary.realizedGains).toBe(64);
      expect(result.summary.totalGainLoss).toBe(91);
      expect(result.summary.totalGainLossPercent).toBe(45.5);
    });

    it('reports a non-zero percent for fully sold profitable positions', async () => {
      setupDashboardMocks();
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        {
          averageBuyPrice: 0,
          currentValue: 0,
          financialAssetKey: 1,
          quantity: 0,
          unrealizedGains: 0,
        },
      ]);
      portfolioHoldingsServiceMock.getRealizedGains.mockResolvedValue({ totalCostBasisOfSold: 100, totalRealizedGains: 25 });

      const result = await service.getAggregateDashboard(appuser, 'YTD');

      expect(result.summary.totalGainLoss).toBe(25);
      expect(result.summary.totalGainLossPercent).toBe(25);
    });
  });

  describe('fees left out of gains', () => {
    function setupIndividual() {
      setupDashboardMocks();
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ name: 'Main', portfolioKey: 1 }]),
        findOne: portfolioWithoutSnapshots({ name: 'Main', portfolioKey: 1 }),
      });
    }

    it.each([
      { load: () => service.getAggregateDashboard(appuser, 'YTD', undefined, { includeFeeConversion: true }), scope: 'aggregate', setup: setupDashboardMocks },
      { load: () => service.getPortfolioDashboard(appuser, 1, 'YTD', undefined, { includeFeeConversion: true }), scope: 'individual', setup: setupIndividual },
    ])('lists the affected assets on the $scope summary when the client asks for them', async ({ load, setup }) => {
      setup();
      portfolioHoldingsServiceMock.getRealizedGains.mockResolvedValue({ feeConversionIncompleteAssetKeys: [3, 9], totalCostBasisOfSold: 100, totalRealizedGains: 20 });

      const result = await load();

      expect(result.summary.feeConversionIncompleteAssetKeys).toEqual([3, 9]);
      expect(result.summary.realizedGains).toBe(20);
    });

    it.each([
      { load: () => service.getAggregateDashboard(appuser, 'YTD'), scope: 'aggregate', setup: setupDashboardMocks },
      { load: () => service.getPortfolioDashboard(appuser, 1, 'YTD'), scope: 'individual', setup: setupIndividual },
    ])('leaves the $scope summary shape unchanged for clients that do not ask, so strict older clients still parse it', async ({ load, setup }) => {
      setup();
      portfolioHoldingsServiceMock.getRealizedGains.mockResolvedValue({ feeConversionIncompleteAssetKeys: [3], totalCostBasisOfSold: 100, totalRealizedGains: 20 });

      const result = await load();

      expect(result.summary).not.toHaveProperty('feeConversionIncompleteAssetKeys');
    });

    it('omits the list when every fee converted', async () => {
      setupDashboardMocks();

      const result = await service.getAggregateDashboard(appuser, 'YTD', undefined, { includeFeeConversion: true });

      expect(result.summary).not.toHaveProperty('feeConversionIncompleteAssetKeys');
    });
  });

  describe('top movers gating', () => {
    it('returns no top movers for a one-holding portfolio', async () => {
      setupDashboardMocks();

      const result = await service.getTopMovers(appuser, 1, 'YTD');

      expect(result.gainers).toEqual([]);
      expect(result.losers).toEqual([]);
    });

    it('uses each holding historical price when computing top movers', async () => {
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ portfolioKey: 1 }]),
        findOne: portfolioWithoutSnapshots({ portfolioKey: 1 }),
      });
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([
        {
          currentPrice: 150,
          currentValue: 120,
          financialAssetKey: 11,
          financialAssetLogoUrl: undefined,
          financialAssetName: 'Winner',
          financialAssetSymbol: 'WIN',
          portfolioKey: 1,
          quantity: 2,
          unrealizedGains: 20,
          unrealizedGainsPercentage: 20,
        },
        {
          currentPrice: 50,
          currentValue: 80,
          financialAssetKey: 22,
          financialAssetName: 'Loser',
          financialAssetSymbol: 'LOS',
          portfolioKey: 2,
          quantity: 4,
          unrealizedGains: -20,
          unrealizedGainsPercentage: -20,
        },
      ]);
      // One batched lookup returns the start price for every asset at once.
      const startDate = new Date('2023-01-01T00:00:00Z');
      assetPriceServiceMock.getPricesAsOf.mockResolvedValue(new Map([
        [11, { date: startDate, price: 100, source: 'market' }],
        [22, { date: startDate, price: 100, source: 'market' }],
      ]));

      const result = await service.getTopMovers(appuser, 1, '1Y', 5);

      expect(result.period).toBe('1Y');
      expect(result.gainers[0]?.ticker).toBe('WIN');
      expect(result.losers[0]?.ticker).toBe('LOS');
      expect(result.gainers[0]?.change).not.toBe(result.losers[0]?.change);
    });
  });

  describe('performance data statuses', () => {
    it('marks one-point portfolio history as insufficient and waits for benchmark comparison', async () => {
      setupDashboardMocks();
      const snapshotsQuery = databaseReturning([
        { currency_code: 'EUR', snapshot_date: '2024-01-01', value: '100' },
      ]);
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { findOne: findOneMock, getKysely: snapshotsQuery });

      const result = await service.getPerformanceData(appuser, 1, 'YTD');

      expect(result.dataPoints).toHaveLength(1);
      expect(result.portfolioHistoryStatus).toBe('insufficient_history');
      expect(result.benchmarkStatus).toBe('waiting_for_portfolio_history');
      expect(result.readiness).toEqual({
        benchmark: { status: 'waiting_for_portfolio_history' },
        performance: { status: 'insufficient_history' },
      });
    });

    it('marks missing benchmark data when portfolio history is ready', async () => {
      setupDashboardMocks();
      const snapshotsQuery = databaseReturning([
        { currency_code: 'EUR', snapshot_date: '2024-01-01', value: '100' },
        { currency_code: 'EUR', snapshot_date: '2024-01-02', value: '110' },
      ]);
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { findOne: findOneMock, getKysely: snapshotsQuery });
      assetPriceServiceMock.getBenchmarkHistoricalPrices.mockResolvedValueOnce([{ date: '2024-01-01', value: 100 }]);

      const result = await service.getPerformanceData(appuser, 1, 'YTD');

      expect(result.portfolioHistoryStatus).toBe('ready');
      expect(result.benchmarkStatus).toBe('missing_benchmark_data');
    });

    it('throws for missing or unowned single portfolios before querying snapshots', async () => {
      setupDashboardMocks();
      const snapshotsQuery = databaseReturning([
        { currency_code: 'EUR', snapshot_date: '2024-01-01', value: '100' },
      ]);
      const findOneMock = vi.fn().mockResolvedValue(null);
      Object.assign(DI.em, { findOne: findOneMock, getKysely: snapshotsQuery });

      await expect(service.getPerformanceData(appuser, 1, 'YTD')).rejects.toThrow('Portfolio not found');
      expect(snapshotsQuery).not.toHaveBeenCalled();
    });

    it('marks benchmark ready when both histories are sufficient', async () => {
      setupDashboardMocks();
      const snapshotsQuery = databaseReturning([
        { currency_code: 'EUR', snapshot_date: '2024-01-01', value: '100' },
        { currency_code: 'EUR', snapshot_date: '2024-01-02', value: '110' },
      ]);
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { findOne: findOneMock, getKysely: snapshotsQuery });
      assetPriceServiceMock.getBenchmarkHistoricalPrices.mockResolvedValueOnce([
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 101 },
      ]);

      const result = await service.getPerformanceData(appuser, 1, 'YTD');

      expect(result.benchmarkStatus).toBe('ready');
      expect(result.readiness.benchmark.status).toBe('ready');
    });

    it('returns null quick stats when allocation or gain percentages are missing', async () => {
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ name: 'Main', portfolioKey: 1 }]),
        findOne: portfolioWithoutSnapshots({ name: 'Main', portfolioKey: 1 }),
      });
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([
        {
          allocation: null,
          currentValue: 280.42,
          financialAssetSymbol: 'AAPL',
          unrealizedGains: 190.42,
          unrealizedGainsPercentage: null,
        },
      ]);

      const result = await service.getPortfolioDashboard(appuser, 1, 'YTD');

      expect(result.quickStats.biggestPosition).toBeNull();
      expect(result.quickStats.bestPerformer).toBeNull();
      expect(result.quickStats.worstPerformer).toBeNull();
    });

    it('omits allocations when current values are unavailable', async () => {
      setupDashboardMocks();
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([
        {
          allocation: null,
          currentValue: null,
          financialAssetSymbol: 'AAPL',
          financialAssetType: 'Stock',
          unrealizedGains: null,
          unrealizedGainsPercentage: null,
        },
      ]);
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        {
          allocation: null,
          currentValue: null,
          financialAssetKey: 1,
          financialAssetType: 'Stock',
        },
      ]);

      const allocation = await service.getAllocation(appuser, 1);

      expect(allocation).toEqual({
        byAsset: [],
        byAssetClass: [],
        bySector: [],
        byType: [],
        driftRows: undefined,
        guidanceText: undefined,
        unclassifiedHoldings: [],
      });
    });

    it('filters benchmark points before the first portfolio point before normalization', async () => {
      setupDashboardMocks();
      const snapshotsQuery = databaseReturning([
        { currency_code: 'EUR', snapshot_date: '2024-01-10', value: '100' },
        { currency_code: 'EUR', snapshot_date: '2024-01-11', value: '110' },
      ]);
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { findOne: findOneMock, getKysely: snapshotsQuery });
      assetPriceServiceMock.getBenchmarkHistoricalPrices.mockResolvedValueOnce([
        { date: '2024-01-01', value: 90 },
        { date: '2024-01-10', value: 100 },
        { date: '2024-01-11', value: 110 },
        { date: '2024-01-12', value: 120 },
      ]);

      const result = await service.getPerformanceData(appuser, 1, 'YTD');

      expect(result.benchmarkDataPoints).toEqual([
        { date: '2024-01-10', value: 100 },
        { date: '2024-01-11', value: 110 },
      ]);
      expect(result.normalizedBenchmarkDataPoints).toEqual([
        { date: '2024-01-10', value: 0 },
        { date: '2024-01-11', value: 10 },
      ]);
      expect(result.benchmarkStatus).toBe('ready');
    });

    it('marks aggregate performance empty when there are no portfolios', async () => {
      setupDashboardMocks();
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([]),
      });

      const result = await service.getPerformanceData(appuser, null, 'YTD');

      expect(result.dataPoints).toEqual([]);
      expect(result.portfolioHistoryStatus).toBe('empty');
      expect(result.benchmarkStatus).toBe('waiting_for_portfolio_history');
    });

    it('replays from the original transaction date when a BUY is moved later', async () => {
      Object.assign(DI.em, {
        find: vi.fn((entity) => {
          if (entity?.name === 'FinancialTransaction') {
            return [
              {
                financialAssetKey: { financialAssetKey: 1, symbol: 'AAPL' },
                financialTransactionTypeKey: { name: 'BUY' },
                portfolioKey: { portfolioKey: 1 },
                quantity: 1,
                settlementAmount: 100,
                settlementCurrencyKey: { code: 'USD', currencyKey: 1 },
                settlementUnitAmount: 100,
                transactionDate: new Date('2024-01-01T00:00:00Z'),
                transactionKey: 10,
              },
            ];
          }
          return [];
        }),
        findOne: vi.fn((entity) => {
          if (entity?.name === 'FinancialTransaction') {
            return {
              financialAssetKey: { financialAssetKey: 1, symbol: 'AAPL' },
              financialTransactionTypeKey: { name: 'BUY' },
              portfolioKey: { portfolioKey: 1 },
              quantity: 1,
              settlementAmount: 100,
              settlementCurrencyKey: { code: 'USD', currencyKey: 1 },
              settlementUnitAmount: 100,
              transactionDate: new Date('2024-01-01T00:00:00Z'),
              transactionKey: 10,
            };
          }
          if (entity?.name === 'Currency') return { code: 'USD', currencyKey: 1 };
          if (entity?.name === 'FinancialTransactionType') return { financialTransactionTypeKey: 1, name: 'BUY' };
          if (entity?.name === 'Portfolio') return { portfolioKey: 1, portfolioOwnerAppuserKey: { currencyKey: { code: 'USD', currencyKey: 1 } } };
          return null;
        }),
        flush: vi.fn(),
        getConnection: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue(undefined) }),
        getTransactionContext: vi.fn(),
        transactional: vi.fn((callback: (entityManager: typeof DI.em) => Promise<void>) => Promise.resolve(callback(DI.em))),
      });

      await portfolioTransactionService.updatePortfolioTransaction(appuser, 1, 10, {
        transactionDate: new Date('2024-01-10T00:00:00Z'),
      }, { enqueue: { send: vi.fn(), sendAfter: vi.fn() } });

      expect(snapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(1, new Date('2024-01-01T00:00:00Z'));
    });

    it('marks aggregate performance insufficient when snapshots have one point', async () => {
      setupDashboardMocks();
      const snapshotRows = [{ currency_code: 'EUR', snapshot_date: '2024-01-01', value: '100' }];
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ portfolioKey: 1 }]),
        getKysely: databaseReturning(snapshotRows),
      });

      const result = await service.getPerformanceData(appuser, null, 'YTD');

      expect(result.portfolioHistoryStatus).toBe('insufficient_history');
      expect(result.benchmarkStatus).toBe('waiting_for_portfolio_history');
    });

    it('scopes aggregate snapshot totals to the requested tenant', async () => {
      setupDashboardMocks();
      const database = kyselyDouble(() => [{ currency_code: 'EUR', snapshot_date: '2024-01-01', value: '100' }]);
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ portfolioKey: 1 }]),
        getKysely: vi.fn(() => database.db),
      });

      await service.getPerformanceData(appuser, null, 'YTD', 42);

      const [query] = database.queries;
      expect(query?.sql).toContain('inner join "portfolio" as "p" on "ps"."portfolio_key" = "p"."portfolio_key"');
      const [, tenantParameter] = /"p"\."tenant_key" = \$(\d+)/.exec(query?.sql ?? '') ?? [];
      expect(query?.parameters[Number(tenantParameter) - 1]).toBe(42);
    });

    it('marks aggregate benchmark missing when history is ready but benchmark is short', async () => {
      setupDashboardMocks();
      const snapshotRows = [
            { currency_code: 'EUR', snapshot_date: '2024-01-01', value: '100' },
            { currency_code: 'EUR', snapshot_date: '2024-01-02', value: '110' },
          ];
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ portfolioKey: 1 }]),
        getKysely: databaseReturning(snapshotRows),
      });
      assetPriceServiceMock.getBenchmarkHistoricalPrices.mockResolvedValueOnce([{ date: '2024-01-01', value: 100 }]);

      const result = await service.getPerformanceData(appuser, null, 'YTD');

      expect(result.portfolioHistoryStatus).toBe('ready');
      expect(result.benchmarkStatus).toBe('missing_benchmark_data');
    });

    it('filters aggregate benchmark points before the first portfolio point before normalization', async () => {
      setupDashboardMocks();
      const snapshotRows = [
            { currency_code: 'EUR', snapshot_date: '2024-01-10', value: '100' },
            { currency_code: 'EUR', snapshot_date: '2024-01-11', value: '110' },
          ];
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ portfolioKey: 1 }]),
        getKysely: databaseReturning(snapshotRows),
      });
      assetPriceServiceMock.getBenchmarkHistoricalPrices.mockResolvedValueOnce([
        { date: '2024-01-01', value: 90 },
        { date: '2024-01-10', value: 100 },
        { date: '2024-01-11', value: 110 },
        { date: '2024-01-12', value: 120 },
      ]);

      const result = await service.getPerformanceData(appuser, null, 'YTD');

      expect(result.benchmarkDataPoints).toEqual([
        { date: '2024-01-10', value: 100 },
        { date: '2024-01-11', value: 110 },
      ]);
      expect(result.normalizedBenchmarkDataPoints).toEqual([
        { date: '2024-01-10', value: 0 },
        { date: '2024-01-11', value: 10 },
      ]);
      expect(result.benchmarkStatus).toBe('ready');
    });
  });

  describe('getAllocation asset-class grouping', () => {
    it('groups holdings by asset class and flags unclassified holdings separately', async () => {
      Object.assign(DI.em, {
        findOne: vi.fn().mockResolvedValue(null),
        getKysely: databaseReturning([
                  { asset_class_name: 'Equities', asset_name: 'Apple Inc.', financial_asset_key: 1 },
                  { asset_class_name: 'Unclassified', asset_name: 'Mystery Asset', financial_asset_key: 2 },
                ]),
      });
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([
        { currentValue: 80, financialAssetKey: 1, financialAssetName: 'Apple Inc.', financialAssetSymbol: 'AAPL', financialAssetType: 'Stock' },
        { currentValue: 20, financialAssetKey: 2, financialAssetName: 'Mystery Asset', financialAssetSymbol: 'MYST', financialAssetType: 'Unclassified' },
      ]);

      const result = await service.getAllocation({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 7, 1);

      expect(result.byAssetClass).toEqual(
        expect.arrayContaining([
          { percentage: 80, type: 'Equities', value: 80 },
          { percentage: 20, type: 'Unclassified', value: 20 },
        ]),
      );
      expect(result.unclassifiedHoldings).toEqual([{ name: 'Mystery Asset', value: 20 }]);
    });

    it('includes driftRows and guidanceText when the portfolio has a target allocation set', async () => {
      Object.assign(DI.em, {
        findOne: vi.fn().mockResolvedValue({ targetAllocation: { Equities: 60, Unclassified: 0 } }),
        getKysely: databaseReturning([{ asset_class_name: 'Equities', asset_name: 'Apple Inc.', financial_asset_key: 1 }]),
      });
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([
        { currentValue: 100, financialAssetKey: 1, financialAssetName: 'Apple Inc.', financialAssetSymbol: 'AAPL', financialAssetType: 'Stock' },
      ]);

      const result = await service.getAllocation({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 7, 1);

      expect(result.driftRows).toEqual(
        expect.arrayContaining([expect.objectContaining({ assetClass: 'Equities', currentPct: 100, targetPct: 60 })]),
      );
      expect(result.guidanceText).toBeNull(); // nothing underweight past 5pt in this fixture
    });

    it('omits driftRows and guidanceText when the portfolio has no target allocation', async () => {
      Object.assign(DI.em, {
        findOne: vi.fn().mockResolvedValue({ targetAllocation: null }),
        getKysely: databaseReturning([]),
      });
      portfolioHoldingsServiceMock.getPortfolioHoldings.mockResolvedValue([]);

      const result = await service.getAllocation({ appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser, 7, 1);

      expect(result.driftRows).toBeUndefined();
      expect(result.guidanceText).toBeUndefined();
    });
  });
});
