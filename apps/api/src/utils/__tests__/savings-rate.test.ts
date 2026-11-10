import { describe, expect, it } from 'vitest';

import { savingsRate, savingsRateNumber, savingsRatePercent } from '../savings-rate';

describe('savingsRate', () => {
  it('is the share of income left after spending', () => {
    expect(savingsRateNumber(1000, 400)).toBe(0.6);
  });

  it('is null when there is no income to save from', () => {
    expect(savingsRate(0, 100)).toBeNull();
    expect(savingsRateNumber(0, 0)).toBeNull();
    expect(savingsRatePercent(0, 100)).toBeNull();
  });

  it('is null when income is negative', () => {
    expect(savingsRateNumber(-100, 50)).toBeNull();
  });

  it('is negative when spending is more than income', () => {
    expect(savingsRateNumber(1000, 1200)).toBe(-0.2);
  });

  it('is above one when refunds make spending negative', () => {
    expect(savingsRateNumber(1000, -100)).toBe(1.1);
  });

  it('states the same rate as the monthly email percentage', () => {
    expect(savingsRatePercent(1000, 400)).toBe('60.00');
    const rate = savingsRateNumber(1000, 400) ?? Number.NaN;
    expect(Number(savingsRatePercent(1000, 400))).toBeCloseTo(rate * 100, 2);
  });
});
