import { startOfYear, subDays, subMonths } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

const portfolioHoldingsServiceMock = vi.hoisted(() => ({
  getPortfolioHoldings: vi.fn(),
  getPortfoliosHoldings: vi.fn(),
  getRealizedGains: vi.fn(),
}));
const assetPriceServiceMock = vi.hoisted(() => ({
  ensureRecentAssetPrice: vi.fn(),
  getBenchmarkHistoricalPrices: vi.fn(),
}));
vi.mock('../financial-asset.service', () => ({ resolveOrCreateFinancialAsset: vi.fn() }));
const snapshotServiceMock = vi.hoisted(() => ({
  backfillSnapshotsForPortfolio: vi.fn(),
}));

vi.mock('@app/app', () => ({ DI: { em: {} } }));
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
        findOne: vi.fn().mockResolvedValue({ name: 'Main', portfolioKey: 1 }),
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
        findOne: vi.fn().mockResolvedValue({ name: 'Main', portfolioKey: 1 }),
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
        findOne: vi.fn().mockResolvedValue({ portfolioKey: 1 }),
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
      // One batched `DISTINCT ON` query returns the start price for every asset at once,
      // replacing the previous per-holding `.first()` lookups.
      const startPriceRows = [
        { financial_asset_key: 11, price: 100 },
        { financial_asset_key: 22, price: 100 },
      ];
      Object.assign(DI.em, { getKysely: databaseReturning(startPriceRows) });

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
      const findMock = vi.fn((entity) => {
        if (entity?.name === 'PortfolioSnapshot') {
          return Promise.resolve([{ appuserCurrencyTotalValue: 100, snapshotDate: new Date('2024-01-01') }]);
        }
        return Promise.resolve([{ name: 'Main', portfolioKey: 1 }]);
      });
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { find: findMock, findOne: findOneMock });

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
      const findMock = vi.fn((entity) => {
        if (entity?.name === 'PortfolioSnapshot') {
          return Promise.resolve([
            { appuserCurrencyTotalValue: 100, snapshotDate: new Date('2024-01-01') },
            { appuserCurrencyTotalValue: 110, snapshotDate: new Date('2024-01-02') },
          ]);
        }
        return Promise.resolve([{ name: 'Main', portfolioKey: 1 }]);
      });
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { find: findMock, findOne: findOneMock });
      assetPriceServiceMock.getBenchmarkHistoricalPrices.mockResolvedValueOnce([{ date: '2024-01-01', value: 100 }]);

      const result = await service.getPerformanceData(appuser, 1, 'YTD');

      expect(result.portfolioHistoryStatus).toBe('ready');
      expect(result.benchmarkStatus).toBe('missing_benchmark_data');
    });

    it('throws for missing or unowned single portfolios before querying snapshots', async () => {
      setupDashboardMocks();
      const findMock = vi.fn((entity) => {
        if (entity?.name === 'PortfolioSnapshot') {
          return Promise.resolve([{ appuserCurrencyTotalValue: 100, snapshotDate: new Date('2024-01-01') }]);
        }
        return Promise.resolve([]);
      });
      const findOneMock = vi.fn().mockResolvedValue(null);
      Object.assign(DI.em, { find: findMock, findOne: findOneMock });

      await expect(service.getPerformanceData(appuser, 1, 'YTD')).rejects.toThrow('Portfolio not found');
      expect(findMock).not.toHaveBeenCalled();
    });

    it('marks benchmark ready when both histories are sufficient', async () => {
      setupDashboardMocks();
      const findMock = vi.fn((entity) => {
        if (entity?.name === 'PortfolioSnapshot') {
          return Promise.resolve([
            { appuserCurrencyTotalValue: 100, snapshotDate: new Date('2024-01-01') },
            { appuserCurrencyTotalValue: 110, snapshotDate: new Date('2024-01-02') },
          ]);
        }
        return Promise.resolve([{ name: 'Main', portfolioKey: 1 }]);
      });
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { find: findMock, findOne: findOneMock });
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
        findOne: vi.fn().mockResolvedValue({ name: 'Main', portfolioKey: 1 }),
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
      const findMock = vi.fn((entity) => {
        if (entity?.name === 'PortfolioSnapshot') {
          return Promise.resolve([
            { appuserCurrencyTotalValue: 100, snapshotDate: new Date('2024-01-10') },
            { appuserCurrencyTotalValue: 110, snapshotDate: new Date('2024-01-11') },
          ]);
        }
        return Promise.resolve([{ name: 'Main', portfolioKey: 1 }]);
      });
      const findOneMock = vi.fn().mockResolvedValue({ benchmarkSymbol: 'SPY' });
      Object.assign(DI.em, { find: findMock, findOne: findOneMock });
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
      const snapshotRows = [{ snapshot_date: '2024-01-01', total_value: '100' }];
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ portfolioKey: 1 }]),
        getKysely: databaseReturning(snapshotRows),
      });

      const result = await service.getPerformanceData(appuser, null, 'YTD');

      expect(result.portfolioHistoryStatus).toBe('insufficient_history');
      expect(result.benchmarkStatus).toBe('waiting_for_portfolio_history');
    });

    it('uses the fallback snapshot total when the appuser total is null', async () => {
      setupDashboardMocks();
      const database = kyselyDouble(() => [
        { appuser_currency_total_value: null, snapshot_date: '2024-01-01', total_value: '125' },
      ]);
      Object.assign(DI.em, {
        find: vi.fn().mockResolvedValue([{ portfolioKey: 1 }]),
        getKysely: vi.fn(() => database.db),
      });

      const result = await service.getPerformanceData(appuser, null, 'YTD');

      expect(result.dataPoints).toEqual([{ date: '2024-01-01', value: 125 }]);
      expect(database.queries[0]?.sql).toContain('SUM(COALESCE(ps.appuser_currency_total_value, ps.total_value)) as "total_value"');
    });

    it('scopes aggregate snapshot totals to the requested tenant', async () => {
      setupDashboardMocks();
      const database = kyselyDouble(() => [{ snapshot_date: '2024-01-01', total_value: '100' }]);
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
            { snapshot_date: '2024-01-01', total_value: '100' },
            { snapshot_date: '2024-01-02', total_value: '110' },
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
            { snapshot_date: '2024-01-10', total_value: '100' },
            { snapshot_date: '2024-01-11', total_value: '110' },
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
