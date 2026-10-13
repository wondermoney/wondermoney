import { subDays } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

import { DI } from '@app/app';
import type { Appuser } from '@entity/Appuser';

import portfolioMetricsService from '../portfolio-metrics.service';
import {
  calculateAnnualizedYield,
  calculateTotalReturn,
  calculateVolatility,
  determineRiskLevel,
} from '../portfolio-metrics.utils';

const portfolioHoldingsServiceMock = vi.hoisted(() => ({
  getPortfoliosHoldings: vi.fn(),
}));

vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('../portfolio-holdings.service', () => ({ default: portfolioHoldingsServiceMock }));

interface MockKnex {
  (table: string): MockQueryBuilder;
  raw: (sql: string) => string;
}

interface MockQueryBuilder {
  groupBy: (value: string) => MockQueryBuilder;
  innerJoin: (table: string, left: string, right: string) => MockQueryBuilder;
  orderBy: (column: string, direction: string) => MockQueryBuilder;
  raw: (sql: string) => string;
  select: (...args: string[]) => MockQueryBuilder;
  then<TResult1 = SnapshotRow[], TResult2 = never>(
    onfulfilled?: ((value: SnapshotRow[]) => PromiseLike<TResult1> | TResult1) | null,
    onrejected?: ((reason: unknown) => PromiseLike<TResult2> | TResult2) | null,
  ): PromiseLike<TResult1 | TResult2>;
  where: (column: string, operator: string, value: Date) => MockQueryBuilder;
  whereNull: (column: string) => MockQueryBuilder;
}

interface SnapshotRow {
  snapshot_date: string;
  total_value: string;
}

function createMockKnex(rows: SnapshotRow[]): MockKnex {
  const builder: MockQueryBuilder = {
    groupBy: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    raw: vi.fn(() => ''),
    select: vi.fn(() => builder),
    then: (onfulfilled, onrejected) => Promise.resolve(rows).then(onfulfilled, onrejected),
    where: vi.fn(() => builder),
    whereNull: vi.fn(() => builder),
  };

  const knex = (() => builder) as unknown as MockKnex;
  knex.raw = vi.fn(() => '');

  return knex;
}

describe('portfolio metrics calculations', () => {
  describe('calculateTotalReturn', () => {
    it('returns 0 when cost basis is 0', () => {
      expect(calculateTotalReturn(1000, 0)).toBe(0);
    });

    it('calculates positive return correctly', () => {
      const result = calculateTotalReturn(1200, 1000);
      expect(result).toBeCloseTo(20); // (1200 - 1000) / 1000 * 100 = 20%
    });

    it('calculates negative return correctly', () => {
      const result = calculateTotalReturn(800, 1000);
      expect(result).toBeCloseTo(-20);
    });
  });

  describe('calculateAnnualizedYield', () => {
    it('returns null when daysHeld is too short', () => {
      expect(calculateAnnualizedYield(10, 0)).toBeNull();
    });

    it('annualizes correctly for one year', () => {
      const result = calculateAnnualizedYield(10, 365);
      expect(result).toBeCloseTo(10);
    });

    it('annualizes correctly for half year', () => {
      // 5% in 182.5 days → annualized > 10%
      const result = calculateAnnualizedYield(5, 182.5);
      expect(result).toBeGreaterThan(10);
    });
  });

  describe('calculateVolatility', () => {
    it('returns null for single snapshot', () => {
      expect(calculateVolatility([{ totalValue: 100 }])).toBeNull();
    });

    it('returns null for empty snapshots', () => {
      expect(calculateVolatility([])).toBeNull();
    });

    it('returns null for constant values', () => {
      const snapshots = [{ totalValue: 100 }, { totalValue: 100 }, { totalValue: 100 }];
      expect(calculateVolatility(snapshots)).toBeNull();
    });

    it('calculates volatility when enough snapshots exist', () => {
      const snapshots = Array.from({ length: 30 }, (_, i) => ({ totalValue: 100 + (i % 2 === 0 ? i : -i) }));
      expect(calculateVolatility(snapshots)).not.toBeNull();
    });
  });

  describe('determineRiskLevel', () => {
    it('returns Low for volatility < 15', () => {
      expect(determineRiskLevel(10)).toBe('Low');
      expect(determineRiskLevel(14.9)).toBe('Low');
    });

    it('returns null when volatility is unavailable', () => {
      expect(determineRiskLevel(null)).toBeNull();
    });

    it('returns Medium for volatility 15-25', () => {
      expect(determineRiskLevel(15)).toBe('Medium');
      expect(determineRiskLevel(24.9)).toBe('Medium');
    });

    it('returns High for volatility >= 25', () => {
      expect(determineRiskLevel(25)).toBe('High');
      expect(determineRiskLevel(50)).toBe('High');
    });
  });

  describe('portfolio metrics service insufficient history', () => {
    it('keeps risk metrics unavailable with only two snapshots', async () => {
      const now = new Date();
      const knex = createMockKnex([
          { snapshot_date: subDays(now, 2).toISOString(), total_value: '100' },
          { snapshot_date: subDays(now, 1).toISOString(), total_value: '110' },
      ]);
      Object.assign(DI.em, {
        findOne: vi
          .fn()
          .mockResolvedValueOnce({ name: 'BUY' })
          .mockResolvedValueOnce({ transactionDate: subDays(now, 5) }),
        getKnex: vi.fn().mockReturnValue(knex),
      });
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 90, currentValue: 110, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const result = await portfolioMetricsService.getPortfoliosMetrics({ appuserKey: 1 } as Appuser);

      expect(result.metrics.readiness).toEqual({
        allocation: { status: 'ready' },
        holdings: { status: 'ready' },
        performance: { status: 'insufficient_history' },
        riskMetrics: { status: 'insufficient_history' },
      });
      expect(result.metrics.volatility).toBeNull();
      expect(result.metrics.riskLevel).toBeNull();
      expect(result.metrics.sharpeRatio).toBeNull();
      expect(result.metrics.maxDrawdown).toBeNull();
    });

    it('uses the first buy date for annual yield', async () => {
      const now = new Date();
      const knex = createMockKnex([]);
      Object.assign(DI.em, {
        findOne: vi
          .fn()
          .mockResolvedValueOnce({ name: 'BUY' })
          .mockResolvedValueOnce({ transactionDate: subDays(now, 90) }),
        getKnex: vi.fn().mockReturnValue(knex),
      });
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 90, currentValue: 280.42, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const result = await portfolioMetricsService.getPortfoliosMetrics({ appuserKey: 1 } as Appuser);

      expect(result.metrics.annualYield).not.toBeNull();
      expect(result.metrics.annualYield).toBeGreaterThan(0);
    });

    it('returns null annual yield when the first buy is too recent even if fromDate is earlier', async () => {
      const now = new Date();
      const knex = createMockKnex([]);
      Object.assign(DI.em, {
        findOne: vi
          .fn()
          .mockResolvedValueOnce({ name: 'BUY' })
          .mockResolvedValueOnce({ transactionDate: subDays(now, 5) }),
        getKnex: vi.fn().mockReturnValue(knex),
      });
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 90, currentValue: 280.42, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const result = await portfolioMetricsService.getPortfoliosMetrics(
        { appuserKey: 1 } as Appuser,
        new Date('2026-01-01'),
      );

      expect(result.metrics.annualYield).toBeNull();
    });

    it('returns nullable advanced metrics when there is only one buy and no snapshot history', async () => {
      const now = new Date();
      const knex = createMockKnex([]);
      Object.assign(DI.em, {
        findOne: vi
          .fn()
          .mockResolvedValueOnce({ name: 'BUY' })
          .mockResolvedValueOnce({ transactionDate: subDays(now, 5) }),
        getKnex: vi.fn().mockReturnValue(knex),
      });
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 90, currentValue: 280.42, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const result = await portfolioMetricsService.getPortfoliosMetrics({ appuserKey: 1 } as Appuser);

      expect(result.metrics.readiness.performance).toEqual({
        status: 'empty',
      });
      expect(result.metrics.readiness.riskMetrics).toEqual({
        status: 'insufficient_history',
      });
      expect(result.metrics.annualYield).toBeNull();
      expect(result.metrics.volatility).toBeNull();
      expect(result.metrics.sharpeRatio).toBeNull();
      expect(result.metrics.maxDrawdown).toBeNull();
      expect(result.metrics.riskLevel).toBeNull();
    });
  });
});
