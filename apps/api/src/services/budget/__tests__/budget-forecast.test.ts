import { describe, expect, it } from 'vitest';

import { RecurringCadence } from '@service/recurring/recurring-types';

import { computeForecast, type ForecastMonthInput, type ForecastRowInput, projectOccurrences } from '../budget-forecast';

const row = (overrides: Partial<ForecastRowInput> = {}): ForecastRowInput => ({
  budgeted: 100,
  categoryKey: 1,
  projected: 0,
  projectedComplete: true,
  rolloverEnabled: false,
  ...overrides,
});

const current = (overrides: Partial<ForecastMonthInput> = {}): ForecastMonthInput => ({
  income: 0,
  month: 11,
  rows: [row({ carriedIn: 0, carriedInComplete: true, spent: 0, spentComplete: true })],
  year: 2026,
  ...overrides,
});

const future = (year: number, month: number, overrides: Partial<ForecastMonthInput> = {}): ForecastMonthInput => ({
  income: 0,
  month,
  rows: [row()],
  year,
  ...overrides,
});

const carry = { carryOverspend: true };

/*
 * A forecast looks at the current month and the months after it. The current month has real
 * spending so far; a later month has none, only what recurring items are expected to take. A month
 * is expected to spend its plan, or more where spending so far plus the upcoming recurring items
 * already exceed it. Net is planned income less that.
 */
describe('budget forecast', () => {
  it('keeps the current month\'s spending as actual and gives later months none', () => {
    const [november, december] = computeForecast([
      current({ rows: [row({ carriedIn: 0, carriedInComplete: true, spent: 40, spentComplete: true })] }),
      future(2026, 12),
    ], carry);

    expect(november).toMatchObject({ kind: 'current', spent: 40 });
    expect(december).toMatchObject({ kind: 'future', spent: null });
  });

  it('expects a month to spend its plan when spending and recurring items stay within it', () => {
    const [november, december] = computeForecast([
      current({ income: 1000, rows: [row({ carriedIn: 0, carriedInComplete: true, projected: 20, spent: 40, spentComplete: true })] }),
      future(2026, 12, { income: 1000, rows: [row({ projected: 30 })] }),
    ], carry);

    expect(november).toMatchObject({ budgeted: 100, expectedSpend: 100, income: 1000, net: 900, projectedSpend: 20 });
    expect(december).toMatchObject({ budgeted: 100, expectedSpend: 100, net: 900, projectedSpend: 30 });
  });

  it('expects more than the plan when spending so far plus upcoming recurring items exceed it', () => {
    const [november, december] = computeForecast([
      current({ income: 500, rows: [row({ carriedIn: 0, carriedInComplete: true, projected: 30, spent: 90, spentComplete: true })] }),
      future(2026, 12, { income: 500, rows: [row({ projected: 140 })] }),
    ], { carryOverspend: false });

    expect(november).toMatchObject({ expectedSpend: 120, net: 380 });
    expect(december).toMatchObject({ expectedSpend: 140, net: 360 });
  });

  it('adds up every category of the month', () => {
    const [november] = computeForecast([
      current({
        income: 1000,
        rows: [
          row({ budgeted: 100, carriedIn: 0, carriedInComplete: true, categoryKey: 1, projected: 10, spent: 120, spentComplete: true }),
          row({ budgeted: 50.5, carriedIn: 0, carriedInComplete: true, categoryKey: 2, projected: 5.25, spent: 10.1, spentComplete: true }),
        ],
      }),
    ], carry);

    // A category over plan is not offset by another under it: 130 + 50.5.
    expect(november).toMatchObject({ budgeted: 150.5, expectedSpend: 180.5, net: 819.5, projectedSpend: 15.25, spent: 130.1 });
  });

  it('starts the current month from the carry the budget month shows', () => {
    const [november] = computeForecast([
      current({ rows: [row({ carriedIn: 25, carriedInComplete: true, rolloverEnabled: true, spent: 0, spentComplete: true })] }),
    ], carry);

    expect(november).toMatchObject({ available: 125, carriedIn: 25, expectedSpend: 125 });
  });

  it('carries a projected overspend into the next month when the budget carries overspend', () => {
    const [, december, january] = computeForecast([
      current({ rows: [row({ carriedIn: 0, carriedInComplete: true, projected: 50, rolloverEnabled: true, spent: 80, spentComplete: true })] }),
      future(2026, 12, { rows: [row({ rolloverEnabled: true })] }),
      future(2027, 1, { rows: [row({ rolloverEnabled: true })] }),
    ], carry);

    // November is expected to spend 130 of 100: December starts 30 short, and spends its 70.
    expect(december).toMatchObject({ available: 70, carriedIn: -30, expectedSpend: 70 });
    expect(january).toMatchObject({ available: 100, carriedIn: 0 });
  });

  it('carries no projected overspend when the budget does not carry it', () => {
    const [, december] = computeForecast([
      current({ rows: [row({ carriedIn: 0, carriedInComplete: true, projected: 50, rolloverEnabled: true, spent: 80, spentComplete: true })] }),
      future(2026, 12, { rows: [row({ rolloverEnabled: true })] }),
    ], { carryOverspend: false });

    expect(december).toMatchObject({ available: 100, carriedIn: 0 });
  });

  it('carries nothing into a month whose row has rollover off', () => {
    const [, december] = computeForecast([
      current({ rows: [row({ carriedIn: 0, carriedInComplete: true, projected: 50, rolloverEnabled: true, spent: 80, spentComplete: true })] }),
      future(2026, 12, { rows: [row({ rolloverEnabled: false })] }),
    ], carry);

    expect(december).toMatchObject({ available: 100, carriedIn: 0 });
  });

  it('never expects a month left with less than nothing to spend below zero', () => {
    const [november] = computeForecast([
      current({ rows: [row({ carriedIn: -150, carriedInComplete: true, rolloverEnabled: true, spent: 0, spentComplete: true })] }),
    ], carry);

    expect(november).toMatchObject({ available: -50, expectedSpend: 0 });
  });

  it('marks a month incomplete when its spending, its carry or its recurring items could not all be converted, and every month a carry reaches from it', () => {
    const months = computeForecast([
      current({ rows: [row({ carriedIn: 0, carriedInComplete: true, rolloverEnabled: true, spent: 0, spentComplete: false })] }),
      future(2026, 12, { rows: [row({ rolloverEnabled: true })] }),
      future(2027, 1, { rows: [row({ rolloverEnabled: false })] }),
      future(2027, 2, { rows: [row({ projectedComplete: false })] }),
    ], carry);

    expect(months.map((month) => month.complete)).toEqual([false, false, true, false]);
  });

  it('marks the current month incomplete when the carry it starts from is', () => {
    const [november] = computeForecast([
      current({ rows: [row({ carriedIn: 10, carriedInComplete: false, rolloverEnabled: true, spent: 0, spentComplete: true })] }),
    ], carry);

    expect(november?.complete).toBe(false);
  });

  it('gives a month with no budget rows its planned income and nothing to spend', () => {
    const [, december] = computeForecast([current(), future(2026, 12, { income: 300, rows: [] })], carry);

    expect(december).toMatchObject({ budgeted: 0, expectedSpend: 0, net: 300 });
  });
});

/*
 * A recurring item is projected forward from its next expected date by its cadence. Only dates
 * from today on count: an earlier one either happened (and is in the actual spending) or was missed.
 */
describe('projecting a recurring item', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const iso = (dates: Date[]) => dates.map((date) => date.toISOString().slice(0, 10));
  const window = { from: day('2026-11-09'), to: day('2027-02-28') };

  it('steps a monthly item by calendar month, keeping its day where the month has it', () => {
    expect(iso(projectOccurrences({ cadence: RecurringCadence.monthly, nextExpectedAt: day('2026-11-30') }, window))).toEqual(['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
  });

  it('steps weekly and every two weeks', () => {
    expect(projectOccurrences({ cadence: RecurringCadence.weekly, nextExpectedAt: day('2026-11-10') }, window)).toHaveLength(16);
    expect(iso(projectOccurrences({ cadence: RecurringCadence.biweekly, nextExpectedAt: day('2026-12-01') }, { from: window.from, to: day('2026-12-31') }))).toEqual(['2026-12-01', '2026-12-15', '2026-12-29']);
  });

  it('steps quarterly and yearly', () => {
    expect(iso(projectOccurrences({ cadence: RecurringCadence.quarterly, nextExpectedAt: day('2026-11-15') }, window))).toEqual(['2026-11-15', '2027-02-15']);
    expect(iso(projectOccurrences({ cadence: RecurringCadence.yearly, nextExpectedAt: day('2026-12-01') }, window))).toEqual(['2026-12-01']);
  });

  it('skips the dates before today of an overdue item', () => {
    expect(iso(projectOccurrences({ cadence: RecurringCadence.monthly, nextExpectedAt: day('2026-10-05') }, window))).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
  });

  it('skips a date the item was already seen on', () => {
    expect(iso(projectOccurrences({ cadence: RecurringCadence.monthly, lastSeenAt: day('2026-11-09'), nextExpectedAt: day('2026-11-09') }, window))).toEqual(['2026-12-09', '2027-01-09', '2027-02-09']);
  });

  it('projects nothing for an item with no next expected date', () => {
    expect(projectOccurrences({ cadence: RecurringCadence.monthly, nextExpectedAt: undefined }, window)).toEqual([]);
  });
});
