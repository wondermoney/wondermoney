import { describe, expect, it } from 'vitest';

import type { RateTable } from '@service/currency/exchange-rate';

import type { InvestmentCashFlow } from '../portfolio-metrics.utils';
import { cashFlowsInViewerCurrency, combinePeriodMeasures, measurePortfolioPeriod, type PeriodCashFlow } from '../portfolio-period-performance';

const buy = (day: string, amount: number): InvestmentCashFlow => ({ amount: -amount, date: new Date(`${day}T10:00:00.000Z`), kind: 'BUY' });
const sell = (day: string, amount: number): InvestmentCashFlow => ({ amount, date: new Date(`${day}T10:00:00.000Z`), kind: 'SELL' });
const dividend = (day: string, amount: number): InvestmentCashFlow => ({ amount, date: new Date(`${day}T10:00:00.000Z`), kind: 'DIVIDEND' });

const fromDate = new Date('2026-01-01T00:00:00.000Z');

describe('measurePortfolioPeriod', () => {
  it('shows no change for monthly buys when prices did not move', () => {
    const flows = Array.from({ length: 10 }, (_, month) => buy(`2026-${String(month + 1).padStart(2, '0')}-05`, 1000));

    const measure = measurePortfolioPeriod({
      end: { kind: 'live', value: 20000 },
      flows,
      fromDate,
      startSnapshot: { day: '2025-12-31', value: 10000 },
    });

    expect(measure.netContributions).toBe(10000);
    expect(measure.change).toBe(0);
    expect(measure.changePercent).toBe(0);
  });

  it('measures the market move against what was held plus what was put in', () => {
    const measure = measurePortfolioPeriod({
      end: { kind: 'live', value: 11500 },
      flows: [buy('2026-03-05', 1500), sell('2026-06-05', 500)],
      fromDate,
      startSnapshot: { day: '2025-12-31', value: 10000 },
    });

    expect(measure.netContributions).toBe(1000);
    expect(measure.change).toBe(500);
    expect(measure.changePercent).toBe(4.55);
  });

  it('leaves out trades the start snapshot already holds, and reports dividends beside the change', () => {
    const measure = measurePortfolioPeriod({
      end: { kind: 'live', value: 10300 },
      flows: [buy('2025-12-31', 400), buy('2026-02-05', 200), dividend('2026-02-10', 25)],
      fromDate,
      startSnapshot: { day: '2025-12-31', value: 10000 },
    });

    expect(measure.netContributions).toBe(200);
    expect(measure.dividends).toBe(25);
    expect(measure.change).toBe(100);
  });

  it('starts from nothing for a portfolio opened during the period', () => {
    const measure = measurePortfolioPeriod({
      end: { kind: 'live', value: 3300 },
      flows: [buy('2026-04-05', 3000)],
      fromDate,
      startSnapshot: null,
    });

    expect(measure.startValue).toBe(0);
    expect(measure.change).toBe(300);
    expect(measure.changePercent).toBe(10);
  });

  it('cannot measure a portfolio that held something but has no start snapshot', () => {
    const measure = measurePortfolioPeriod({
      end: { kind: 'live', value: 5000 },
      flows: [buy('2025-06-05', 4000), buy('2026-04-05', 500)],
      fromDate,
      startSnapshot: null,
    });

    expect(measure.startValue).toBeNull();
    expect(measure.change).toBeNull();
    expect(measure.changePercent).toBeNull();
  });

  it('counts trades only up to the end snapshot day for a period that has ended', () => {
    const measure = measurePortfolioPeriod({
      end: { day: '2026-06-30', kind: 'snapshot', value: 10600 },
      flows: [buy('2026-03-05', 500), buy('2026-07-05', 9000)],
      fromDate,
      startSnapshot: { day: '2025-12-31', value: 10000 },
    });

    expect(measure.netContributions).toBe(500);
    expect(measure.change).toBe(100);
  });

  describe('a cash flow with no amount in the viewer\'s currency (no rate converts it)', () => {
    const unconverted = (flow: InvestmentCashFlow): PeriodCashFlow => ({ ...flow, amount: null });

    it('makes the contributions and the change unknown when it is a trade in the period', () => {
      const measure = measurePortfolioPeriod({
        end: { kind: 'live', value: 11500 },
        flows: [buy('2026-03-05', 1000), unconverted(buy('2026-04-05', 500))],
        fromDate,
        startSnapshot: { day: '2025-12-31', value: 10000 },
      });

      expect(measure).toMatchObject({ change: null, changePercent: null, endValue: 11500, netContributions: null, startValue: 10000 });
    });

    it('makes only the dividends unknown when it is a dividend', () => {
      const measure = measurePortfolioPeriod({
        end: { kind: 'live', value: 10100 },
        flows: [dividend('2026-02-10', 25), unconverted(dividend('2026-03-10', 30))],
        fromDate,
        startSnapshot: { day: '2025-12-31', value: 10000 },
      });

      expect(measure).toMatchObject({ change: 100, dividends: null, netContributions: 0 });
    });

    it('changes nothing when the start snapshot already holds it', () => {
      const measure = measurePortfolioPeriod({
        end: { kind: 'live', value: 10100 },
        flows: [unconverted(buy('2025-12-20', 900))],
        fromDate,
        startSnapshot: { day: '2025-12-31', value: 10000 },
      });

      expect(measure).toMatchObject({ change: 100, netContributions: 0 });
    });

    it('makes the combined return unknown', () => {
      const known = measurePortfolioPeriod({ end: { kind: 'live', value: 1100 }, flows: [], fromDate, startSnapshot: { day: '2025-12-31', value: 1000 } });
      const unknown = measurePortfolioPeriod({ end: { kind: 'live', value: 1100 }, flows: [unconverted(buy('2026-02-05', 100))], fromDate, startSnapshot: { day: '2025-12-31', value: 1000 } });

      expect(combinePeriodMeasures([known, unknown])).toEqual({ change: null, changePercent: null });
    });
  });
});

describe('cashFlowsInViewerCurrency', () => {
  const rates: RateTable = {
    rateOn: (from, to, date) => {
      if (from === to) return 1;
      if (from !== 'EUR' || to !== 'USD') return null;
      return date.getTime() >= Date.parse('2026-03-01T00:00:00Z') ? 1.5 : 1.25;
    },
  };

  it('converts each flow at the rate of its own date, and leaves the viewer\'s own currency alone', () => {
    const flows = cashFlowsInViewerCurrency([
      { ...buy('2026-02-05', 100), currencyCode: 'EUR' },
      { ...sell('2026-03-05', 100), currencyCode: 'EUR' },
      { ...dividend('2026-03-10', 10), currencyCode: 'USD' },
    ], 'USD', rates);

    expect(flows.map((flow) => flow.amount)).toEqual([-125, 150, 10]);
  });

  it('gives a flow no amount when no rate converts it or its currency is unknown, never its face value', () => {
    const flows = cashFlowsInViewerCurrency([
      { ...buy('2026-02-05', 100), currencyCode: 'GBP' },
      { ...buy('2026-02-05', 100), currencyCode: null },
    ], 'USD', rates);

    expect(flows.map((flow) => flow.amount)).toEqual([null, null]);
  });
});

describe('combinePeriodMeasures', () => {
  it('adds portfolios up before taking the percentage', () => {
    const longTerm = measurePortfolioPeriod({ end: { kind: 'live', value: 11500 }, flows: [buy('2026-03-05', 1000)], fromDate, startSnapshot: { day: '2025-12-31', value: 10000 } });
    const techPicks = measurePortfolioPeriod({ end: { kind: 'live', value: 1900 }, flows: [], fromDate, startSnapshot: { day: '2025-12-31', value: 2000 } });

    const combined = combinePeriodMeasures([longTerm, techPicks]);

    expect(combined.change).toBe(400);
    expect(combined.changePercent).toBe(3.08);
  });

  it('is unknown when any portfolio cannot be measured', () => {
    const known = measurePortfolioPeriod({ end: { kind: 'live', value: 1100 }, flows: [], fromDate, startSnapshot: { day: '2025-12-31', value: 1000 } });
    const unknown = measurePortfolioPeriod({ end: { kind: 'live', value: 900 }, flows: [buy('2025-05-05', 800)], fromDate, startSnapshot: null });

    expect(combinePeriodMeasures([known, unknown])).toEqual({ change: null, changePercent: null });
  });

  it('has no percentage when nothing was held or put in', () => {
    expect(combinePeriodMeasures([])).toEqual({ change: 0, changePercent: null });
  });
});
