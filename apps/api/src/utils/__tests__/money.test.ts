import { describe, expect, it } from 'vitest';

import {
  addMoney,
  convertMoney,
  moneyEquals,
  roundDisplay,
  subtractMoney,
  sumMoney,
} from '@utils/money';

describe('money arithmetic', () => {
  it('adds without float drift', () => {
    // The canonical case: 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
  });

  it('sums a long series without accumulating error', () => {
    // A hundred additions of 0.01 drifts visibly with `+=` on doubles.
    const hundredCents = Array.from({ length: 100 }, () => 0.01);
    expect(sumMoney(hundredCents)).toBe(1);

    let floatTotal = 0;
    for (const value of hundredCents) floatTotal += value;
    expect(floatTotal).not.toBe(1); // documents the behaviour this module replaces
  });

  it('reproduces a realistic running balance exactly', () => {
    // Mirrors accumulateChain: an opening balance plus a mix of debits and credits.
    // 1234.56 - 45.67 - 1189.01 + 0.12 == 0 exactly; with `+=` on doubles it does not.
    const movements = [1234.56, -45.67, -1189.01, 0.12];
    expect(sumMoney(movements)).toBe(0);
  });

  it('rounds half-even, symmetrically across the sign boundary', () => {
    // This is the bug the module exists to fix. `Math.round` rounds toward +Infinity for
    // negatives, so with expenses stored negative, income and expenses previously rounded
    // in opposite directions.
    expect(roundDisplay(2.345)).toBe(2.34);
    expect(roundDisplay(-2.345)).toBe(-2.34);
    expect(roundDisplay(2.355)).toBe(2.36);
    expect(roundDisplay(-2.355)).toBe(-2.36);

    // The asymmetry in the previous implementation, documented:
    expect(Math.round(-0.5)).toBe(-0)  ;
    expect(Math.round(0.5)).toBe(1);
  });


  it('converts currency and rounds once at the end', () => {
    // 19.99 * 1.0825 = 21.6391... — the previous bare multiply stored the full double.
    expect(convertMoney(19.99, 1.0825)).toBe(21.6392);
    expect(convertMoney(100, 1)).toBe(100);
  });

  it('treats null, undefined and unparseable input as zero rather than NaN', () => {
    expect(addMoney(null, 5)).toBe(5);
    expect(addMoney(undefined, 5)).toBe(5);
    expect(sumMoney([1, null, undefined, 2])).toBe(3);
    // `Number(undefined)` is NaN, which silently poisons a whole aggregate.
    expect(Number.isNaN(sumMoney([undefined]))).toBe(false);
  });

  it('compares at scale instead of using an epsilon tolerance', () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    // Differ inside the column's scale -> genuinely different stored values.
    expect(moneyEquals(1.0001, 1.0002)).toBe(false);
    // Differ only beyond the column's scale -> the same stored value.
    expect(moneyEquals(1.000041, 1.000042)).toBe(true);
  });
});
