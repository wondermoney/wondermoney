import { describe, expect, it } from 'vitest';

import { budgetMonthOf, budgetPeriodDays, budgetPeriodRange, isBudgetPeriodStartDay } from '../budget-period';

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const days = (startDay: number, year: number, month: number) => budgetPeriodDays(budgetPeriodRange({ periodStartDay: startDay }, year, month));

describe('budget period range', () => {
  it('with start day 1 is the calendar month, the same days the budget has always counted', () => {
    for (let month = 1; month <= 12; month += 1) {
      const range = budgetPeriodRange({ periodStartDay: 1 }, 2026, month);
      expect(range.start).toEqual(new Date(Date.UTC(2026, month - 1, 1)));
      expect(range.end).toEqual(new Date(Date.UTC(2026, month, 1)));
    }
    expect(days(1, 2028, 2)).toEqual({ firstDay: '2028-02-01', lastDay: '2028-02-29' });
  });

  it('with start day 25 names a month after the month it ends in: November is 25 October to 24 November', () => {
    expect(days(25, 2026, 11)).toEqual({ firstDay: '2026-10-25', lastDay: '2026-11-24' });
    expect(budgetPeriodRange({ periodStartDay: 25 }, 2026, 11)).toEqual({ end: utc('2026-11-25'), start: utc('2026-10-25') });
  });

  it('crosses the year ends: January starts in December, December ends in December', () => {
    expect(days(25, 2027, 1)).toEqual({ firstDay: '2026-12-25', lastDay: '2027-01-24' });
    expect(days(25, 2026, 12)).toEqual({ firstDay: '2026-11-25', lastDay: '2026-12-24' });
    expect(days(1, 2026, 12)).toEqual({ firstDay: '2026-12-01', lastDay: '2026-12-31' });
  });

  it('with start day 28 fits February in common and leap years', () => {
    expect(days(28, 2026, 2)).toEqual({ firstDay: '2026-01-28', lastDay: '2026-02-27' });
    expect(days(28, 2026, 3)).toEqual({ firstDay: '2026-02-28', lastDay: '2026-03-27' });
    expect(days(28, 2028, 3)).toEqual({ firstDay: '2028-02-28', lastDay: '2028-03-27' });
  });

  it('leaves no day out and counts none twice between consecutive months', () => {
    for (const startDay of [1, 2, 15, 25, 28]) {
      for (let month = 1; month <= 12; month += 1) {
        const next = month === 12 ? { month: 1, year: 2027 } : { month: month + 1, year: 2026 };
        expect(budgetPeriodRange({ periodStartDay: startDay }, next.year, next.month).start).toEqual(budgetPeriodRange({ periodStartDay: startDay }, 2026, month).end);
      }
    }
  });

  it.each([0, 29, 31, 2.5, Number.NaN])('refuses start day %s: only 1 to 28 is a day every month has', (startDay) => {
    expect(isBudgetPeriodStartDay(startDay)).toBe(false);
    expect(() => budgetPeriodRange({ periodStartDay: startDay }, 2026, 2)).toThrow(RangeError);
  });
});

describe('the budget month a day is in', () => {
  it('with start day 25 counts 24 November in November and 25 November in December', () => {
    expect(budgetMonthOf({ periodStartDay: 25 }, utc('2026-11-24'))).toEqual({ month: 11, year: 2026 });
    expect(budgetMonthOf({ periodStartDay: 25 }, new Date('2026-11-24T23:59:59.999Z'))).toEqual({ month: 11, year: 2026 });
    expect(budgetMonthOf({ periodStartDay: 25 }, utc('2026-11-25'))).toEqual({ month: 12, year: 2026 });
  });

  it('moves the end of December into January of the next year', () => {
    expect(budgetMonthOf({ periodStartDay: 25 }, utc('2026-12-25'))).toEqual({ month: 1, year: 2027 });
    expect(budgetMonthOf({ periodStartDay: 25 }, utc('2026-12-24'))).toEqual({ month: 12, year: 2026 });
  });

  it('with start day 1 is the calendar month of the UTC day', () => {
    expect(budgetMonthOf({ periodStartDay: 1 }, utc('2026-12-31'))).toEqual({ month: 12, year: 2026 });
    expect(budgetMonthOf({ periodStartDay: 1 }, utc('2027-01-01'))).toEqual({ month: 1, year: 2027 });
  });

  it('is the month whose range holds the day', () => {
    for (const startDay of [1, 10, 28]) {
      for (let day = 0; day < 400; day += 7) {
        const date = new Date(Date.UTC(2026, 0, 1 + day, 13));
        const { month, year } = budgetMonthOf({ periodStartDay: startDay }, date);
        const range = budgetPeriodRange({ periodStartDay: startDay }, year, month);
        expect(date >= range.start && date < range.end).toBe(true);
      }
    }
  });
});
