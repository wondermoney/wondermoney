import { describe, expect, it } from 'vitest';

import { big } from '@utils/money';

import { allocateProRata } from '../category-lines';

const sum = (parts: number[]) => parts.reduce((total, part) => total.plus(big(part)), big(0));

/*
 * A split line's amount in the user's currency (and a line rescaled after its transaction's amount
 * changed) is a share of the transaction's amount, in proportion to the lines. The shares must add
 * up to the transaction exactly: a cent lost or invented in rounding would make a split
 * transaction count differently from the same spending entered as separate transactions.
 */
describe('allocateProRata', () => {
  it('gives back the weights when they already sum to the total', () => {
    expect(allocateProRata(-100, [-60, -40])).toEqual([-60, -40]);
  });

  it('converts each line at the transaction\'s rate', () => {
    // 50 USD stored as 45.6789 EUR, split 20 / 30.
    expect(allocateProRata(-45.6789, [-20, -30])).toEqual([-18.2716, -27.4073]);
  });

  it('puts the rounding remainder on the largest line', () => {
    expect(allocateProRata(10, [1, 2])).toEqual([3.3333, 6.6667]);
    expect(allocateProRata(10, [2, 1])).toEqual([6.6667, 3.3333]);
  });

  it('puts the remainder on the first of equally large lines', () => {
    expect(allocateProRata(100, [1, 1, 1])).toEqual([33.3334, 33.3333, 33.3333]);
  });

  it('rounds a share half away from zero, as Postgres does', () => {
    // Each share is 0.00015: 0.0002 each, then the first takes what is left of the total.
    expect(allocateProRata(0.0003, [1, 1])).toEqual([0.0001, 0.0002]);
    expect(allocateProRata(-0.0003, [-1, -1])).toEqual([-0.0001, -0.0002]);
  });

  it('rounds to the scale asked for, still summing exactly', () => {
    expect(allocateProRata(-90, [-33.33, -66.67], 2)).toEqual([-30, -60]);
    expect(allocateProRata(-90.01, [-33.33, -66.67], 2)).toEqual([-30, -60.01]);
  });

  it('always sums exactly to the total', () => {
    const totals = [-0.01, -1, -9.99, -45.6789, -1234.5678, 0.07, 19.99, 99_999.9999];
    const weightSets = [[1, 1], [1, 2, 3], [-3.33, -3.33, -3.34], [7, 11, 13, 17], [0.01, 999.99]];
    for (const total of totals) {
      for (const weights of weightSets) {
        const parts = allocateProRata(total, weights);
        expect(parts).toHaveLength(weights.length);
        expect(sum(parts).eq(big(total))).toBe(true);
      }
    }
  });
});
