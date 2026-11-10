import { subDays } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

import { kyselyDouble } from '@app/__tests__/__helpers__/kysely-double';
import { DI } from '@app/app';
import type { Appuser } from '@entity/Appuser';

import portfolioMetricsService from '../portfolio-metrics.service';
import {
  calculateMaxDrawdown,
  calculateMoneyWeightedAnnualYield,
  calculateTotalReturn,
  calculateVolatility,
  determineRiskLevel,
  type InvestmentCashFlow,
} from '../portfolio-metrics.utils';

const portfolioHoldingsServiceMock = vi.hoisted(() => ({
  getInvestmentCashFlows: vi.fn(),
  getPortfoliosHoldings: vi.fn(),
}));

vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('../portfolio-holdings.service', () => ({ default: portfolioHoldingsServiceMock }));

interface SnapshotRow {
  snapshot_day: string;
  total_value: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A viewer who keeps EUR, the currency every flow and snapshot below is in. */
const VIEWER = { appuserKey: 1, currencyKey: { code: 'EUR' } } as Appuser;
const START = new Date('2023-01-02T00:00:00Z');

/** `n` calendar days after START. */
function buy(amount: number, onDay: number): InvestmentCashFlow {
  return { amount: -amount, date: day(onDay), kind: 'BUY' };
}

function day(n: number): Date {
  return new Date(START.getTime() + n * DAY_MS);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One snapshot per calendar day from START, with these values. */
function dailySnapshots(values: number[], firstDay = 0) {
  return values.map((totalValue, i) => ({ day: dayKey(day(firstDay + i)), totalValue }));
}

/** `returns` daily moves alternating +1% and -1%, starting from `start`: stdev exactly 1%/day when even. */
function alternatingValues(returns: number, start = 1000): number[] {
  const values = [start];
  for (let i = 0; i < returns; i++) values.push(values[i]! * (i % 2 === 0 ? 1.01 : 0.99));
  return values;
}

/** The database as the snapshot query sees it: these rows, whatever the SQL. */
function createDatabase(rows: SnapshotRow[]) {
  return kyselyDouble(() => rows.map((row) => ({ currency_code: 'EUR', ...row }))).db;
}

/** Daily snapshot rows that alternate 100 / 110, so returns are never flat. */
function arrangeMetrics({ firstBuyDaysAgo, snapshots }: { firstBuyDaysAgo: number; snapshots: number }) {
  const now = new Date();
  Object.assign(DI.em, {
    getKysely: vi.fn().mockReturnValue(createDatabase(snapshotRows(snapshots, now))),
  });
  portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue([
    { amount: -90, currencyCode: 'EUR', date: subDays(now, firstBuyDaysAgo), kind: 'BUY' },
  ]);
  portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
    { averageBuyPrice: 90, currentValue: 280.42, financialAssetType: 'Stock', quantity: 1 },
  ]);
}

function oscillatingSnapshots(count: number) {
  return dailySnapshots(Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 100 : 110)));
}

function snapshotRows(count: number, now: Date): SnapshotRow[] {
  return oscillatingSnapshots(count).map((snapshot, i) => ({
    snapshot_day: subDays(now, count - i).toISOString().slice(0, 10),
    total_value: String(snapshot.totalValue),
  }));
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

  describe('calculateMoneyWeightedAnnualYield', () => {
    it('is the compound annual rate of a single buy held two years', () => {
      // 1,000 grows to 1,210 over two years: 10% a year.
      expect(calculateMoneyWeightedAnnualYield([buy(1000, 0)], 1210, day(730))).toBeCloseTo(10, 6);
    });

    it('is not distorted by a contribution made a year after the first buy', () => {
      // An asset growing 10% a year: 1,000 bought on day 0 is 1,100 a year later, 1,000 more is
      // added (2,100), and the lot is 2,310 at two years. The investor earned 10% a year. Compounding
      // the cost-basis return (2,310 / 2,000 = +15.5%) over the two years since the first buy
      // reported 7.5%.
      const flows = [buy(1000, 0), buy(1000, 365)];
      expect(calculateMoneyWeightedAnnualYield(flows, 2310, day(730))).toBeCloseTo(10, 6);
    });

    it('counts a sale as money returned to the investor', () => {
      // Bought for 1,000, sold a year later for 1,100, nothing left: 10%.
      const flows = [buy(1000, 0), { amount: 1100, date: day(365), kind: 'SELL' as const }];
      expect(calculateMoneyWeightedAnnualYield(flows, 0, day(400))).toBeCloseTo(10, 6);
    });

    it('counts a dividend as money returned to the investor', () => {
      // A 10% coupon on 1,000 for two years, ending at 1,100: a 10% yield.
      const flows = [buy(1000, 0), { amount: 100, date: day(365), kind: 'DIVIDEND' as const }];
      expect(calculateMoneyWeightedAnnualYield(flows, 1100, day(730))).toBeCloseTo(10, 6);
    });

    it('reports a loss as a negative yield', () => {
      // 1,000 down to 810 over two years: -10% a year.
      expect(calculateMoneyWeightedAnnualYield([buy(1000, 0)], 810, day(730))).toBeCloseTo(-10, 6);
    });

    it('does not annualise anything held for less than a year', () => {
      // 39.7% over 35 days would compound to ~3,000% a year — not a real figure.
      expect(calculateMoneyWeightedAnnualYield([buy(1000, 0)], 1397, day(35))).toBeNull();
      expect(calculateMoneyWeightedAnnualYield([buy(1000, 0)], 1100, day(364))).toBeNull();
    });

    it('does not annualise a round trip shorter than a year that ended over a year ago', () => {
      const flows = [buy(1000, 0), { amount: 1100, date: day(60), kind: 'SELL' as const }];
      expect(calculateMoneyWeightedAnnualYield(flows, 0, day(500))).toBeNull();
    });

    it('is null without any cash flows', () => {
      expect(calculateMoneyWeightedAnnualYield([], 1000, day(730))).toBeNull();
    });

    it('is null when nothing ever came back to the investor', () => {
      // Every flow is a buy and nothing is left: no rate solves it.
      expect(calculateMoneyWeightedAnnualYield([buy(1000, 0), buy(500, 200)], 0, day(730))).toBeNull();
    });
  });

  describe('calculateVolatility', () => {
    it('returns null for single snapshot', () => {
      expect(calculateVolatility(dailySnapshots([100]))).toBeNull();
    });

    it('returns null for empty snapshots', () => {
      expect(calculateVolatility([])).toBeNull();
    });

    it('returns null for constant values', () => {
      expect(calculateVolatility(dailySnapshots([100, 100, 100]))).toBeNull();
    });

    it('returns null with under three months of daily snapshots', () => {
      expect(calculateVolatility(oscillatingSnapshots(30))).toBeNull();
      expect(calculateVolatility(oscillatingSnapshots(89))).toBeNull();
    });

    it('calculates volatility once three months of daily snapshots exist', () => {
      expect(calculateVolatility(oscillatingSnapshots(90))).toBeGreaterThan(0);
    });

    it('annualises calendar-day returns over 365 days', () => {
      // Snapshots are taken every calendar day, so a 1% daily stdev is 1% x sqrt(365) = 19.10% a
      // year. Scaling calendar-day returns by sqrt(252) reported 15.87%.
      expect(calculateVolatility(dailySnapshots(alternatingValues(90)))).toBeCloseTo(19.105, 2);
    });

    it('does not count a contribution as a return', () => {
      // The same ±1% series with 1,000 bought on day 45: that day the value jumps by the purchase,
      // not by the market, and every later day moves the bigger portfolio by the same ±1%.
      const values = alternatingValues(90);
      const scale = 1 + 1000 / values[45]!;
      const withContribution = values.map((value, i) => (i >= 45 ? value * scale : value));
      const flows = [buy(1000, 45)];

      expect(calculateVolatility(dailySnapshots(withContribution), flows)).toBeCloseTo(19.105, 2);
    });

    it('does not count a sale as a return', () => {
      const values = alternatingValues(90);
      const withSale = values.map((value, i) => (i >= 45 ? value / 2 : value));
      const flows = [{ amount: values[45]! / 2, date: day(45), kind: 'SELL' as const }];

      expect(calculateVolatility(dailySnapshots(withSale), flows)).toBeCloseTo(19.105, 2);
    });

    it('skips the return across a day with no snapshot', () => {
      // Two ±1% runs, the second at five times the level after a three-day gap: the jump across the
      // gap is not a daily return.
      const snapshots = [...dailySnapshots(alternatingValues(46)), ...dailySnapshots(alternatingValues(46, 5000), 50)];
      expect(calculateVolatility(snapshots)).toBeCloseTo(19.105, 2);
    });
  });

  describe('calculateMaxDrawdown', () => {
    /** `days` values rising 0.5% a day from 1,000. */
    function risingValues(days: number): number[] {
      return Array.from({ length: days }, (_, i) => 1000 * Math.pow(1.005, i));
    }

    it('returns null with under a month of daily snapshots', () => {
      expect(calculateMaxDrawdown(dailySnapshots(risingValues(29)))).toBeNull();
    });

    it('is the peak-to-trough drop of the value when nothing is bought or sold', () => {
      // 1,000 falls to 750 and recovers: a 25% drawdown.
      const values = [...Array.from({ length: 20 }, () => 1000), 750, ...Array.from({ length: 19 }, () => 1000)];
      expect(calculateMaxDrawdown(dailySnapshots(values))).toBeCloseTo(25, 8);
    });

    it('does not count a full sale as a drawdown', () => {
      // A rising portfolio sold outright on day 40 at that day's value: nothing is left, but nothing was lost.
      const rising = risingValues(41);
      const values = [...rising.slice(0, 40), 0, 0, 0, 0, 0];
      const flows = [{ amount: rising[40]!, date: day(40), kind: 'SELL' as const }];

      expect(calculateMaxDrawdown(dailySnapshots(values), flows)).toBeCloseTo(0, 8);
    });

    it('does not count a partial sale as a drawdown', () => {
      // Half sold on day 20 of a rising portfolio: the value halves, the investment does not fall.
      const rising = risingValues(40);
      const values = rising.map((value, i) => (i >= 20 ? value / 2 : value));
      const flows = [{ amount: rising[20]! / 2, date: day(20), kind: 'SELL' as const }];

      expect(calculateMaxDrawdown(dailySnapshots(values), flows)).toBeCloseTo(0, 8);
    });

    it('measures a real price drop with a buy partway down', () => {
      // 10 units at 100 for 15 days; on day 15 the price is 90 and 10 more units are bought for 900;
      // on day 16 it is 80 and stays there. The price fell 100 -> 80: a 20% drawdown. The value's own
      // peak-to-trough (1,800 -> 1,600) said 11.1%, because the buy hid half the fall.
      const prices = [...Array.from({ length: 15 }, () => 100), 90, ...Array.from({ length: 19 }, () => 80)];
      const values = prices.map((price, i) => price * (i >= 15 ? 20 : 10));
      const flows = [buy(900, 15)];

      expect(calculateMaxDrawdown(dailySnapshots(values), flows)).toBeCloseTo(20, 8);
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
      const database = createDatabase([
          { snapshot_day: subDays(now, 2).toISOString().slice(0, 10), total_value: '100' },
          { snapshot_day: subDays(now, 1).toISOString().slice(0, 10), total_value: '110' },
      ]);
      Object.assign(DI.em, { getKysely: vi.fn().mockReturnValue(database) });
      portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue([
        { amount: -90, currencyCode: 'EUR', date: subDays(now, 5), kind: 'BUY' },
      ]);
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 90, currentValue: 110, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const result = await portfolioMetricsService.getPortfoliosMetrics(VIEWER);

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

    it('reports the money-weighted annual yield of the dated cash flows', async () => {
      const now = new Date();
      Object.assign(DI.em, { getKysely: vi.fn().mockReturnValue(createDatabase([])) });
      // 1,000 bought two years ago, 1,000 more a year ago, worth 2,310 now: 10% a year.
      portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue([
        { amount: -1000, currencyCode: 'EUR', date: subDays(now, 730), kind: 'BUY' },
        { amount: -1000, currencyCode: 'EUR', date: subDays(now, 365), kind: 'BUY' },
      ]);
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 1000, currentValue: 2310, financialAssetType: 'Stock', quantity: 2 },
      ]);

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(VIEWER);

      expect(metrics.totalReturn).toBeCloseTo(15.5, 6);
      // Days from `now`, so a daylight-saving hour can shift the year fraction slightly.
      expect(metrics.annualYield).toBeCloseTo(10, 3);
    });

    it('scopes the cash flows to the household when a tenant is given', async () => {
      Object.assign(DI.em, { getKysely: vi.fn().mockReturnValue(createDatabase([])) });
      portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue([]);
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([]);

      await portfolioMetricsService.getPortfoliosMetrics(VIEWER, undefined, 77);

      expect(portfolioHoldingsServiceMock.getInvestmentCashFlows).toHaveBeenCalledWith(1, 77);
    });

    it('returns null annual yield when the first buy is too recent even if fromDate is earlier', async () => {
      const now = new Date();
      const database = createDatabase([]);
      Object.assign(DI.em, { getKysely: vi.fn().mockReturnValue(database) });
      portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue([
        { amount: -90, currencyCode: 'EUR', date: subDays(now, 5), kind: 'BUY' },
      ]);
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 90, currentValue: 280.42, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const result = await portfolioMetricsService.getPortfoliosMetrics(
        VIEWER,
        new Date('2026-01-01'),
      );

      expect(result.metrics.annualYield).toBeNull();
    });

    it('returns nullable advanced metrics when there is only one buy and no snapshot history', async () => {
      const now = new Date();
      const database = createDatabase([]);
      Object.assign(DI.em, { getKysely: vi.fn().mockReturnValue(database) });
      portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue([
        { amount: -90, currencyCode: 'EUR', date: subDays(now, 5), kind: 'BUY' },
      ]);
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 90, currentValue: 280.42, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const result = await portfolioMetricsService.getPortfoliosMetrics(VIEWER);

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

  describe('portfolio metrics service minimum history', () => {
    it('keeps the cumulative return but withholds annualised figures after five weeks', async () => {
      arrangeMetrics({ firstBuyDaysAgo: 35, snapshots: 35 });

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(VIEWER);

      expect(metrics.totalReturn).toBeCloseTo(211.58, 1);
      expect(metrics.annualYield).toBeNull();
      expect(metrics.volatility).toBeNull();
      expect(metrics.sharpeRatio).toBeNull();
      expect(metrics.riskLevel).toBeNull();
      // Drawdown is a plain peak-to-trough figure, not annualised.
      expect(metrics.maxDrawdown).not.toBeNull();
    });

    it('shows volatility from three months of history but withholds yield and Sharpe until a year', async () => {
      arrangeMetrics({ firstBuyDaysAgo: 120, snapshots: 120 });

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(VIEWER);

      expect(metrics.volatility).toBeGreaterThan(0);
      expect(metrics.riskLevel).not.toBeNull();
      expect(metrics.annualYield).toBeNull();
      expect(metrics.sharpeRatio).toBeNull();
    });

    it('reports every annualised metric once a year of history exists', async () => {
      arrangeMetrics({ firstBuyDaysAgo: 400, snapshots: 120 });

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(VIEWER);

      expect(metrics.annualYield).toBeGreaterThan(0);
      expect(metrics.volatility).toBeGreaterThan(0);
      expect(metrics.sharpeRatio).not.toBeNull();
    });

    it('takes the annual yield less the risk-free rate over calendar-day volatility for Sharpe', async () => {
      const now = new Date();
      const values = alternatingValues(90);
      const rows = values.map((value, i) => ({
        snapshot_day: subDays(now, values.length - i).toISOString().slice(0, 10),
        total_value: String(value),
      }));
      Object.assign(DI.em, { getKysely: vi.fn().mockReturnValue(createDatabase(rows)) });
      // 1,000 two years ago worth 1,210 now: a 10% yield.
      portfolioHoldingsServiceMock.getInvestmentCashFlows.mockResolvedValue([{ amount: -1000, currencyCode: 'EUR', date: subDays(now, 730), kind: 'BUY' }]);
      portfolioHoldingsServiceMock.getPortfoliosHoldings.mockResolvedValue([
        { averageBuyPrice: 1000, currentValue: 1210, financialAssetType: 'Stock', quantity: 1 },
      ]);

      const { metrics } = await portfolioMetricsService.getPortfoliosMetrics(VIEWER);

      // (10% - 4.5%) / (1% x sqrt(365)) = 5.5 / 19.105
      expect(metrics.volatility).toBeCloseTo(19.105, 2);
      expect(metrics.sharpeRatio).toBeCloseTo(0.2879, 3);
    });
  });
});
