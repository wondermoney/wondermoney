import { describe, expect, it } from 'vitest';

import { splitInstallmentAmounts } from '../installment-split';

const centsOf = (amounts: number[]) => amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0);

describe('splitting a purchase into installments', () => {
  it.each([
    { count: 3, expected: [33.33, 33.33, 33.34], total: 100 },
    { count: 12, expected: [...Array<number>(11).fill(83.33), 83.37], total: 1000 },
    { count: 2, expected: [0.5, 0.51], total: 1.01 },
    { count: 4, expected: [25, 25, 25, 25], total: 100 },
    { count: 3, expected: [0.33, 0.33, 0.34], total: 1 },
    { count: 7, expected: [...Array<number>(6).fill(142.85), 142.9], total: 1000 },
  ])('splits $total into $count with the rounding on the last one', ({ count, expected, total }) => {
    const amounts = splitInstallmentAmounts(total, count);

    expect(amounts).toEqual(expected);
    expect(centsOf(amounts)).toBe(Math.round(total * 100));
  });

  it('sums exactly to the total for every count up to 120', () => {
    for (const total of [9.99, 1234.56, 99_999.99, 7]) {
      for (let count = 1; count <= 120; count += 1) {
        const amounts = splitInstallmentAmounts(total, count);
        expect(amounts).toHaveLength(count);
        expect(centsOf(amounts)).toBe(Math.round(total * 100));
        // Every installment but the last is the same amount.
        expect(new Set(amounts.slice(0, -1)).size).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rounds the total to cents before splitting', () => {
    expect(splitInstallmentAmounts(10.005, 2)).toEqual([5, 5.01]);
  });

  it('rejects a count it cannot split into', () => {
    expect(() => splitInstallmentAmounts(100, 0)).toThrow(RangeError);
    expect(() => splitInstallmentAmounts(100, 1.5)).toThrow(RangeError);
    expect(() => splitInstallmentAmounts(0.02, 3)).toThrow(RangeError);
  });
});
