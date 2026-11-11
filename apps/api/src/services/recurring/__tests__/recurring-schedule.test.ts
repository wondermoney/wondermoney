import { describe, expect, it } from 'vitest';

import {
  buildRecurringSchedule,
  expandRecurringSchedule,
  type RecurringScheduleOccurrence,
  type RecurringScheduleSeries,
} from '../recurring-schedule';
import { RecurringAmountType, RecurringCadence, RecurringOccurrenceMatchStatus } from '../recurring-types';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

const series = (overrides: Partial<RecurringScheduleSeries> = {}): RecurringScheduleSeries => ({
  amountType: RecurringAmountType.fixed,
  cadence: RecurringCadence.monthly,
  currency: 'EUR',
  displayName: 'Rent',
  expectedAmount: 850,
  nextExpectedAt: day('2026-03-05'),
  recurringSeriesKey: 1,
  ...overrides,
});

const occurrence = (
  date: string,
  overrides: Partial<RecurringScheduleOccurrence> = {},
): RecurringScheduleOccurrence & { seriesKey: number } => ({
  amount: 850,
  currency: 'EUR',
  date: day(date),
  matchStatus: RecurringOccurrenceMatchStatus.matched,
  seriesKey: 1,
  ...overrides,
});

describe('expandRecurringSchedule', () => {
  it('steps a weekly series in seven-day intervals', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.weekly, nextExpectedAt: day('2026-03-02') },
      day('2026-03-01'),
      day('2026-03-31'),
    );

    expect(dates.map(iso)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
  });

  it('steps a biweekly series in fourteen-day intervals', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.biweekly, nextExpectedAt: day('2026-03-02') },
      day('2026-03-01'),
      day('2026-03-31'),
    );

    expect(dates.map(iso)).toEqual(['2026-03-02', '2026-03-16', '2026-03-30']);
  });

  it('clamps a monthly series anchored on the 31st to each month end and returns to the 31st', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.monthly, nextExpectedAt: day('2026-01-31') },
      day('2026-01-01'),
      day('2026-04-30'),
    );

    expect(dates.map(iso)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('steps a quarterly series three months at a time', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.quarterly, nextExpectedAt: day('2026-02-15') },
      day('2026-01-01'),
      day('2026-12-31'),
    );

    expect(dates.map(iso)).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']);
  });

  it('steps a yearly series twelve months at a time', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.yearly, nextExpectedAt: day('2026-06-01') },
      day('2026-01-01'),
      day('2026-12-31'),
    );

    expect(dates.map(iso)).toEqual(['2026-06-01']);
  });

  it('includes both range boundaries and nothing outside them', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.weekly, nextExpectedAt: day('2026-03-02') },
      day('2026-03-09'),
      day('2026-03-23'),
    );

    expect(dates.map(iso)).toEqual(['2026-03-09', '2026-03-16', '2026-03-23']);
  });

  it('counts a range end given as midnight as the whole of that day', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.monthly, nextExpectedAt: new Date('2026-03-31T12:00:00.000Z') },
      day('2026-03-01'),
      day('2026-03-31'),
    );

    expect(dates.map(iso)).toEqual(['2026-03-31']);
  });

  it('steps forward from a next date that is already in the past', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.monthly, nextExpectedAt: day('2026-01-05') },
      day('2026-03-01'),
      day('2026-03-31'),
    );

    expect(dates.map(iso)).toEqual(['2026-03-05']);
  });

  it('steps back to an earlier occurrence when the next date is later than the range', () => {
    const dates = expandRecurringSchedule(
      { cadence: RecurringCadence.monthly, nextExpectedAt: day('2026-04-05') },
      day('2026-03-01'),
      day('2026-03-31'),
    );

    expect(dates.map(iso)).toEqual(['2026-03-05']);
  });

  it('returns nothing without a next expected date or with an inverted range', () => {
    expect(expandRecurringSchedule({ cadence: RecurringCadence.monthly, nextExpectedAt: null }, day('2026-03-01'), day('2026-03-31'))).toEqual([]);
    expect(expandRecurringSchedule({ cadence: RecurringCadence.monthly, nextExpectedAt: day('2026-03-05') }, day('2026-03-31'), day('2026-03-01'))).toEqual([]);
  });
});

describe('buildRecurringSchedule', () => {
  const range = { from: day('2026-03-01'), to: day('2026-03-31'), today: day('2026-03-15') };

  it('marks a matched past occurrence paid on the day it was actually paid', () => {
    const entries = buildRecurringSchedule(
      [series({ nextExpectedAt: day('2026-03-05') })],
      [occurrence('2026-03-06')],
      range,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: day('2026-03-06'), status: 'paid' });
  });

  it('marks an expected past date with no payment overdue', () => {
    const entries = buildRecurringSchedule([series({ nextExpectedAt: day('2026-03-05') })], [], range);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: day('2026-03-05'), status: 'overdue' });
  });

  it('marks an expected date today due and a later one projected', () => {
    const due = buildRecurringSchedule([series({ nextExpectedAt: day('2026-03-15') })], [], range);
    const projected = buildRecurringSchedule([series({ nextExpectedAt: day('2026-03-20') })], [], range);

    expect(due.map((entry) => [iso(entry.date), entry.status])).toEqual([['2026-03-15', 'due']]);
    expect(projected.map((entry) => [iso(entry.date), entry.status])).toEqual([['2026-03-20', 'projected']]);
  });

  it('does not treat a removed or missed occurrence as paid', () => {
    const entries = buildRecurringSchedule(
      [series({ nextExpectedAt: day('2026-03-05') })],
      [
        occurrence('2026-03-05', { matchStatus: RecurringOccurrenceMatchStatus.manual_removed }),
        occurrence('2026-03-05', { matchStatus: RecurringOccurrenceMatchStatus.missed }),
      ],
      range,
    );

    expect(entries.map((entry) => entry.status)).toEqual(['overdue']);
  });

  it('matches a payment a few days late to its expected date without double counting', () => {
    const entries = buildRecurringSchedule(
      [series({ nextExpectedAt: day('2026-03-05') })],
      [occurrence('2026-03-09')],
      range,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: day('2026-03-09'), status: 'paid' });
  });

  it('keeps an extra payment that matches no expected date', () => {
    const entries = buildRecurringSchedule(
      [series({ nextExpectedAt: day('2026-03-05') })],
      [occurrence('2026-03-05'), occurrence('2026-03-20')],
      range,
    );

    expect(entries.map((entry) => [iso(entry.date), entry.status])).toEqual([
      ['2026-03-05', 'paid'],
      ['2026-03-20', 'paid'],
    ]);
  });

  it('uses the occurrence amount and currency when the payment records them', () => {
    const entries = buildRecurringSchedule(
      [series({ currency: 'EUR', expectedAmount: 850, nextExpectedAt: day('2026-03-05') })],
      [occurrence('2026-03-05', { amount: 872.4, currency: 'USD' })],
      range,
    );

    expect(entries[0]).toMatchObject({ currency: 'USD', expectedAmount: 872.4 });
  });

  it('falls back to the series expected amount for an unpaid date and a variable series max', () => {
    const entries = buildRecurringSchedule(
      [
        series({
          amountType: RecurringAmountType.variable,
          expectedAmount: null,
          expectedAmountMax: 120,
          nextExpectedAt: day('2026-03-20'),
        }),
      ],
      [],
      range,
    );

    expect(entries[0]).toMatchObject({ currency: 'EUR', expectedAmount: 120, status: 'projected' });
  });

  it('sorts entries by date and then name', () => {
    const entries = buildRecurringSchedule(
      [
        series({ displayName: 'Zeta', nextExpectedAt: day('2026-03-20'), recurringSeriesKey: 2 }),
        series({ displayName: 'Alpha', nextExpectedAt: day('2026-03-20'), recurringSeriesKey: 3 }),
        series({ displayName: 'Early', nextExpectedAt: day('2026-03-01'), recurringSeriesKey: 4 }),
      ],
      [],
      range,
    );

    expect(entries.map((entry) => entry.name)).toEqual(['Early', 'Alpha', 'Zeta']);
  });

  it('ignores a series with no next expected date', () => {
    expect(buildRecurringSchedule([series({ nextExpectedAt: null })], [], range)).toEqual([]);
  });
});
