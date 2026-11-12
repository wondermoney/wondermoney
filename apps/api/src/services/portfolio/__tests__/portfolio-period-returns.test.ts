import { describe, expect, it } from 'vitest';

import {
  calculatePeriodMoneyWeightedReturn,
  calculateTimeWeightedReturn,
  combineReturnSeries,
  type PeriodCashFlow,
  periodReturnsOf,
  type SnapshotPoint,
} from '../portfolio-period-performance';

const at = (day: string) => new Date(`${day}T10:00:00.000Z`);
const buy = (day: string, amount: number): PeriodCashFlow => ({ amount: -amount, date: at(day), kind: 'BUY' });
const sell = (day: string, amount: number): PeriodCashFlow => ({ amount, date: at(day), kind: 'SELL' });
const dividend = (day: string, amount: number): PeriodCashFlow => ({ amount, date: at(day), kind: 'DIVIDEND' });
const unconverted = (flow: PeriodCashFlow): PeriodCashFlow => ({ ...flow, amount: null });
const point = (day: string, value: null | number): SnapshotPoint => ({ day, value });

describe('calculateTimeWeightedReturn', () => {
  // Each row is a portfolio's daily values; the first opens the period.
  it.each([
    {
      expected: 5,
      flows: [],
      name: 'no flows: the simple return (end - start) / start',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1100), point('2026-03-03', 1050)],
    },
    {
      expected: 0,
      flows: [buy('2026-03-03', 1000)],
      name: 'doubling the money mid-period at an unchanged price',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1000), point('2026-03-03', 2000), point('2026-03-04', 2000)],
    },
    {
      // +10% on day 2 and +10% on day 4, with or without the deposit: 1.1 * 1.1 - 1.
      expected: 21,
      flows: [buy('2026-03-03', 1100)],
      name: 'a mid-period deposit between two +10% days',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1100), point('2026-03-03', 2200), point('2026-03-04', 2420)],
    },
    {
      expected: 21,
      flows: [],
      name: 'the same two +10% days without the deposit',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1100), point('2026-03-03', 1100), point('2026-03-04', 1210)],
    },
    {
      expected: 21,
      flows: [sell('2026-03-03', 550)],
      name: 'a mid-period withdrawal between two +10% days',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1100), point('2026-03-03', 550), point('2026-03-04', 605)],
    },
    {
      expected: 0,
      flows: [sell('2026-03-03', 500)],
      name: 'a withdrawal at an unchanged price',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1000), point('2026-03-03', 500), point('2026-03-04', 500)],
    },
    {
      // A dividend leaves the portfolio for the investor: 10 on 1000 is 1%.
      expected: 1,
      flows: [dividend('2026-03-02', 10)],
      name: 'a dividend paid out counts as return',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1000)],
    },
    {
      // Bought 1000 on the first day and it closed at 1010.
      expected: 1,
      flows: [buy('2026-03-02', 1000)],
      name: 'a portfolio opened in the period starts from its first buy',
      snapshots: [point('2026-03-01', 0), point('2026-03-02', 1010), point('2026-03-03', 1010)],
    },
    {
      expected: 10,
      flows: [buy('2026-02-27', 999), buy('2026-03-01', 999)],
      name: 'trades the start value already holds are not flows',
      snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1100)],
    },
  ])('$name', ({ expected, flows, snapshots }) => {
    const result = calculateTimeWeightedReturn(snapshots, flows);

    expect(result.value).toBeCloseTo(expected, 10);
    expect(result.missingDates).toEqual([]);
  });

  it('gives the cumulative return at each snapshot, starting from 0', () => {
    const result = calculateTimeWeightedReturn(
      [point('2026-03-01', 1000), point('2026-03-02', 1100), point('2026-03-03', 2200), point('2026-03-04', 2420)],
      [buy('2026-03-03', 1100)],
    );

    expect(result.index.map((entry) => entry.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']);
    expect(result.index.map((entry) => Number(entry.value.toFixed(10)))).toEqual([0, 10, 10, 21]);
  });

  describe('a day with no snapshot', () => {
    it('carries the last value over it and reports it, rather than reading it as zero', () => {
      const result = calculateTimeWeightedReturn([point('2026-03-01', 1000), point('2026-03-04', 1100)], []);

      expect(result.value).toBeCloseTo(10, 10);
      expect(result.missingDates).toEqual(['2026-03-02', '2026-03-03']);
      expect(result.index.map((entry) => entry.date)).toEqual(['2026-03-01', '2026-03-04']);
    });

    it('counts a flow on the missing day at the next snapshot', () => {
      // 1000 held, 500 put in on the missing day, 1650 at the next snapshot: (1650 - 500) / 1000 - 1.
      const result = calculateTimeWeightedReturn([point('2026-03-01', 1000), point('2026-03-03', 1650)], [buy('2026-03-02', 500)]);

      expect(result.value).toBeCloseTo(15, 10);
      expect(result.missingDates).toEqual(['2026-03-02']);
    });

    it('treats a snapshot that could not be converted as missing', () => {
      const result = calculateTimeWeightedReturn([point('2026-03-01', 1000), point('2026-03-02', null), point('2026-03-03', 1100)], []);

      expect(result.value).toBeCloseTo(10, 10);
      expect(result.missingDates).toEqual(['2026-03-02']);
      expect(result.index.map((entry) => entry.date)).toEqual(['2026-03-01', '2026-03-03']);
    });

    it('does not report the days after everything was sold, which have no snapshot because nothing was held', () => {
      // Sold for 1100 what was worth 1000, then held nothing until the end.
      const result = calculateTimeWeightedReturn([point('2026-03-01', 1000), point('2026-03-05', 0)], [sell('2026-03-02', 1100)]);

      expect(result.value).toBeCloseTo(10, 10);
      expect(result.missingDates).toEqual([]);
    });
  });

  it('is unknown when the start value is', () => {
    expect(calculateTimeWeightedReturn([point('2026-03-01', null), point('2026-03-02', 1000)], []).value).toBeNull();
  });

  it('is unknown when the end value is', () => {
    expect(calculateTimeWeightedReturn([point('2026-03-01', 1000), point('2026-03-02', null)], []).value).toBeNull();
  });

  it('stops at a flow with no amount in the viewer\'s currency, keeping the days before it', () => {
    const result = calculateTimeWeightedReturn(
      [point('2026-03-01', 1000), point('2026-03-02', 1100), point('2026-03-03', 1700)],
      [unconverted(buy('2026-03-03', 500))],
    );

    expect(result.value).toBeNull();
    expect(result.index.map((entry) => entry.date)).toEqual(['2026-03-01', '2026-03-02']);
  });

  it('measures nothing without a snapshot', () => {
    expect(calculateTimeWeightedReturn([], [])).toEqual({ index: [], missingDates: [], value: null });
  });
});

describe('calculatePeriodMoneyWeightedReturn', () => {
  // Expected values come from an independent solve of the same flows (Newton's method from 10%,
  // confirmed by bisection, in Python), the convention of spreadsheet XIRR: years are days / 365
  // from the first date. For a period under a year the annual rate r is turned into the period's,
  // (1 + r) ^ (days / 365) - 1.
  it('matches spreadsheet XIRR for a period of a year or more, annualised', () => {
    // XIRR({-10000, -5000, 2000, 150, 14500}, {2024-01-01, 2024-04-01, 2024-09-15, 2024-11-01, 2025-01-01}) = 12.547976%.
    const result = calculatePeriodMoneyWeightedReturn(
      point('2024-01-01', 10_000),
      point('2025-01-01', 14_500),
      [buy('2024-04-01', 5000), sell('2024-09-15', 2000), dividend('2024-11-01', 150)],
    );

    expect(result.annualized).toBe(true);
    expect(result.value).toBeCloseTo(12.547976, 4);
  });

  it('gives the period rate, not an annual one, for a period under a year', () => {
    // XIRR({-10000, -1000, 11500}, {2025-01-01, 2025-02-15, 2025-04-01}) = 20.775916% a year,
    // which over the 90 days is 1.20775916 ^ (90 / 365) - 1 = 4.764545%.
    const result = calculatePeriodMoneyWeightedReturn(point('2025-01-01', 10_000), point('2025-04-01', 11_500), [buy('2025-02-15', 1000)]);

    expect(result.annualized).toBe(false);
    expect(result.value).toBeCloseTo(4.764545, 4);
  });

  it('starts from the first buy of a portfolio opened in the period', () => {
    // XIRR({-2000, -1000, 3300}, {2025-03-10, 2025-06-10, 2026-03-10}) = 10.956653%.
    const result = calculatePeriodMoneyWeightedReturn(point('2025-03-09', 0), point('2026-03-10', 3300), [buy('2025-03-10', 2000), buy('2025-06-10', 1000)]);

    expect(result.annualized).toBe(true);
    expect(result.value).toBeCloseTo(10.956653, 4);
  });

  it('leaves out trades the start value already holds and trades after the end', () => {
    const result = calculatePeriodMoneyWeightedReturn(
      point('2025-01-01', 10_000),
      point('2025-04-01', 11_500),
      [buy('2024-12-20', 777), buy('2025-01-01', 777), buy('2025-02-15', 1000), buy('2025-04-02', 777)],
    );

    expect(result.value).toBeCloseTo(4.764545, 4);
  });

  it('is unknown when the start, the end or a flow has no value', () => {
    const flows = [buy('2025-02-15', 1000)];
    expect(calculatePeriodMoneyWeightedReturn(point('2025-01-01', null), point('2025-04-01', 11_500), flows).value).toBeNull();
    expect(calculatePeriodMoneyWeightedReturn(point('2025-01-01', 10_000), point('2025-04-01', null), flows).value).toBeNull();
    expect(calculatePeriodMoneyWeightedReturn(point('2025-01-01', 10_000), point('2025-04-01', 11_500), [unconverted(buy('2025-02-15', 1000))]).value).toBeNull();
  });

  it('is unknown with nothing invested', () => {
    expect(calculatePeriodMoneyWeightedReturn(point('2025-01-01', 0), point('2025-04-01', 0), []).value).toBeNull();
  });
});

describe('combineReturnSeries', () => {
  it('adds a portfolio opened later from its first day, its buy a flow rather than a gain', () => {
    const combined = combineReturnSeries([
      { flows: [], snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1100), point('2026-03-03', 1100)] },
      { flows: [buy('2026-03-02', 500)], snapshots: [point('2026-03-02', 500), point('2026-03-03', 550)] },
    ], '2026-03-01');

    expect(combined.snapshots).toEqual([point('2026-03-01', 1000), point('2026-03-02', 1600), point('2026-03-03', 1650)]);
    // +10% on 1000, then 50 on 1600.
    expect(calculateTimeWeightedReturn(combined.snapshots, combined.flows).value).toBeCloseTo((1.1 * (1650 / 1600) - 1) * 100, 10);
  });

  it('counts a portfolio as empty from the day it was sold out, not as a missing snapshot', () => {
    const combined = combineReturnSeries([
      { flows: [], snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1000), point('2026-03-03', 1000), point('2026-03-04', 1000)] },
      { flows: [sell('2026-03-03', 1000)], snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1000)] },
    ], '2026-03-01');

    expect(combined.snapshots.map((entry) => entry.value)).toEqual([2000, 2000, 1000, 1000]);
    const result = calculateTimeWeightedReturn(combined.snapshots, combined.flows);
    expect(result.value).toBeCloseTo(0, 10);
    expect(result.missingDates).toEqual([]);
  });

  it('leaves out a day one portfolio has no snapshot for, so the household carries it as missing', () => {
    const combined = combineReturnSeries([
      { flows: [], snapshots: [point('2026-03-01', 1000), point('2026-03-02', 1000), point('2026-03-03', 1100)] },
      { flows: [], snapshots: [point('2026-03-01', 1000), point('2026-03-03', 1100)] },
    ], '2026-03-01');

    expect(combined.snapshots.map((entry) => entry.day)).toEqual(['2026-03-01', '2026-03-03']);
    const result = calculateTimeWeightedReturn(combined.snapshots, combined.flows);
    expect(result.value).toBeCloseTo(10, 10);
    expect(result.missingDates).toEqual(['2026-03-02']);
  });

  it('carries a start snapshot older than the household\'s start, counting its later trades in the first step', () => {
    // The second portfolio's latest snapshot before the period is from 2026-02-20; 500 was put in since.
    const combined = combineReturnSeries([
      { flows: [], snapshots: [point('2026-02-28', 1000), point('2026-03-01', 1000)] },
      { flows: [buy('2026-02-25', 500)], snapshots: [point('2026-02-20', 1000), point('2026-03-01', 1500)] },
    ], '2026-02-28');

    expect(combined.snapshots).toEqual([point('2026-02-28', 2000), point('2026-03-01', 2500)]);
    expect(calculateTimeWeightedReturn(combined.snapshots, combined.flows).value).toBeCloseTo(0, 10);
  });
});

describe('periodReturnsOf', () => {
  it('gives both returns for one portfolio, net of a deposit', () => {
    const returns = periodReturnsOf([{ flows: [buy('2025-02-15', 10_000)], snapshots: [point('2025-01-01', 10_000), point('2025-02-15', 20_000), point('2025-04-01', 20_000)] }]);

    expect(returns.timeWeighted).toBeCloseTo(0, 10);
    expect(returns.moneyWeighted).toBeCloseTo(0, 6);
    expect(returns.moneyWeightedAnnualized).toBe(false);
    expect(returns.missingSnapshotDates).toEqual(days('2025-01-02', '2025-03-31').filter((day) => day !== '2025-02-15'));
  });

  it('is unknown with no portfolio', () => {
    expect(periodReturnsOf([])).toEqual({ missingSnapshotDates: [], moneyWeighted: null, moneyWeightedAnnualized: false, timeWeighted: null });
  });
});

function days(from: string, through: string): string[] {
  const out: string[] = [];
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${through}T00:00:00Z`); time += 86_400_000) {
    out.push(new Date(time).toISOString().slice(0, 10));
  }
  return out;
}
