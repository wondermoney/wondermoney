import { describe, expect, it } from 'vitest';

import { computeRollover, type RolloverMonthInput } from '../budget-rollover';

const month = (year: number, monthNumber: number, overrides: Partial<RolloverMonthInput> = {}): RolloverMonthInput => ({
  budgeted: 100,
  month: monthNumber,
  rolloverEnabled: true,
  spendingComplete: true,
  spent: 0,
  year,
  ...overrides,
});

const carry = { carryOverspend: true };

/*
 * With rollover on, a month's available amount is its budget plus what the month before left
 * over, positive or negative: available(n) = budgeted(n) + carry(n), carry(n+1) = available(n) - spent(n).
 */
describe('budget rollover', () => {
  it('adds last month\'s surplus to this month', () => {
    const [, august] = computeRollover([month(2026, 7, { spent: 60 }), month(2026, 8)], carry);

    expect(august).toMatchObject({ available: 140, rolledOver: 40 });
  });

  it('takes last month\'s overspend off this month', () => {
    const [, august] = computeRollover([month(2026, 7, { spent: 125 }), month(2026, 8)], carry);

    expect(august).toMatchObject({ available: 75, rolledOver: -25 });
  });

  it('keeps carrying through a chain of months', () => {
    const results = computeRollover([month(2026, 7, { spent: 60 }), month(2026, 8, { spent: 200 }), month(2026, 9, { budgeted: 50 })], carry);

    // July leaves 40; August has 140 and spends 200, leaving -60; September has 50 - 60.
    expect(results.map((result) => [result.rolledOver, result.available])).toEqual([[0, 100], [40, 140], [-60, -10]]);
  });

  it('carries nothing into the first month of a chain', () => {
    const [july] = computeRollover([month(2026, 7, { spent: 30 })], carry);

    expect(july).toMatchObject({ available: 100, rolledOver: 0 });
  });

  it('crosses December into January', () => {
    const [, january] = computeRollover([month(2026, 12, { spent: 90 }), month(2027, 1)], carry);

    expect(january).toMatchObject({ available: 110, rolledOver: 10, year: 2027 });
  });

  it('stops carrying from the month rollover is turned off, and starts afresh after it', () => {
    const results = computeRollover([
      month(2026, 7, { spent: 60 }),
      month(2026, 8, { rolloverEnabled: false, spent: 20 }),
      month(2026, 9, { spent: 10 }),
      month(2026, 10),
    ], carry);

    expect(results.map((result) => result.rolledOver)).toEqual([0, 0, 0, 90]);
    expect(results[1]).toMatchObject({ available: 100 });
  });

  it('breaks the chain at a month with no budget row', () => {
    const results = computeRollover([month(2026, 7, { spent: 60 }), month(2026, 9)], carry);

    expect(results.map((result) => result.rolledOver)).toEqual([0, 0]);
  });

  it('carries a refund-only month (no spending) as an untouched budget', () => {
    // Budget spending is floored at zero, so a month of refunds spent nothing.
    const [, august] = computeRollover([month(2026, 7, { spent: 0 }), month(2026, 8)], carry);

    expect(august).toMatchObject({ available: 200, rolledOver: 100 });
  });

  it('drops overspend when the budget does not carry it, but still carries surplus', () => {
    const capped = { carryOverspend: false };
    const results = computeRollover([month(2026, 7, { spent: 160 }), month(2026, 8, { spent: 70 }), month(2026, 9)], capped);

    expect(results.map((result) => [result.rolledOver, result.available])).toEqual([[0, 100], [0, 100], [30, 130]]);
  });

  it('carries exact decimal amounts', () => {
    const [, august] = computeRollover([month(2026, 7, { budgeted: 0.3, spent: 0.1 }), month(2026, 8, { budgeted: 0.1 })], carry);

    expect(august).toMatchObject({ available: 0.3, rolledOver: 0.2 });
  });

  it('flags a carried amount that rests on a month with spending it could not convert, until the chain breaks', () => {
    const results = computeRollover([
      month(2026, 6),
      month(2026, 7, { spendingComplete: false, spent: 60 }),
      month(2026, 8),
      month(2026, 9),
      month(2026, 10, { rolloverEnabled: false }),
      month(2026, 11),
    ], carry);

    // The known spending is carried; every month the July carry reaches is flagged.
    expect(results.map((result) => result.rolledOverIncomplete)).toEqual([false, false, true, true, false, false]);
    expect(results[2]).toMatchObject({ rolledOver: 140 });
  });

  it('orders months itself', () => {
    const results = computeRollover([month(2026, 8), month(2026, 7, { spent: 60 })], carry);

    expect(results.map((result) => [result.month, result.rolledOver])).toEqual([[7, 0], [8, 40]]);
  });
});
