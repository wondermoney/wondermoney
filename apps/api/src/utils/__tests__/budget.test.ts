import { describe, expect, it } from 'vitest';

import {
  calculateTotalMonthlyIncome,
  convertRecurrencyIntoMonthsInYear,
  convertRecurrencyMonthsIntoString,
  convertToMonthlyAmount,
  getMonthsFromRecurrency,
  Recurrency,
} from '@utils/budget';

describe('budget utils', () => {
  it('maps recurrency enums to month counts', () => {
    expect(getMonthsFromRecurrency(Recurrency.MONTHLY)).toBe(12);
    expect(getMonthsFromRecurrency(Recurrency.MONTHLY_14)).toBe(14);
    expect(getMonthsFromRecurrency(Recurrency.QUARTERLY)).toBe(4);
    expect(getMonthsFromRecurrency(Recurrency.ANNUALLY)).toBe(1);
    expect(getMonthsFromRecurrency(Recurrency.BI_ANNUALLY)).toBe(2);
  });

  it('converts recurrency strings into months in a year with defaults', () => {
    expect(convertRecurrencyIntoMonthsInYear('MONTHLY')).toBe(12);
    expect(convertRecurrencyIntoMonthsInYear('MONTHLY_14')).toBe(14);
    expect(convertRecurrencyIntoMonthsInYear('QUARTERLY')).toBe(4);
    expect(convertRecurrencyIntoMonthsInYear('ANNUALLY')).toBe(1);
    expect(convertRecurrencyIntoMonthsInYear('BI_ANNUALLY')).toBe(2);
    expect(convertRecurrencyIntoMonthsInYear('UNKNOWN')).toBe(1);
  });

  it('converts month counts back into recurrency strings with default fallback', () => {
    expect(convertRecurrencyMonthsIntoString(12)).toBe(Recurrency.MONTHLY);
    expect(convertRecurrencyMonthsIntoString(14)).toBe(Recurrency.MONTHLY_14);
    expect(convertRecurrencyMonthsIntoString(4)).toBe(Recurrency.QUARTERLY);
    expect(convertRecurrencyMonthsIntoString(1)).toBe(Recurrency.ANNUALLY);
    expect(convertRecurrencyMonthsIntoString(2)).toBe(Recurrency.BI_ANNUALLY);
    expect(convertRecurrencyMonthsIntoString(99)).toBe(Recurrency.ANNUALLY);
  });

  it('converts amounts to monthly based on recurrency', () => {
    expect(convertToMonthlyAmount(1200, Recurrency.MONTHLY)).toBe(1200);
    expect(convertToMonthlyAmount(1200, Recurrency.QUARTERLY)).toBeCloseTo(400);
    expect(convertToMonthlyAmount(1200, 'ANNUALLY')).toBeCloseTo(100);
  });

  it('sums mixed incomes into monthly totals', () => {
    const incomes = [
      { amount: 1200, recurrency: Recurrency.MONTHLY },
      { amount: 2400, recurrency: Recurrency.QUARTERLY },
      { amount: 500, recurrency: 'ANNUALLY' },
      { amount: 300, recurrency: Recurrency.MONTHLY_14 },
      { amount: 200, isRecurrent: false, recurrency: Recurrency.MONTHLY }, // one-time
    ];
    // monthly: 1200 + 800 + ~41.67 + 350 + 200(one-time) = ~2591.67
    expect(calculateTotalMonthlyIncome(incomes)).toBeCloseTo(2591.67, 2);
  });
});

