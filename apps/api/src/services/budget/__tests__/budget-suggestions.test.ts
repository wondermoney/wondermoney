import { Big } from 'big.js';
import { describe, expect, it } from 'vitest';

import {
  medianOf,
  roundUpToNearestFive,
  summarizeBudgetSuggestions,
} from '../budget-suggestions';
import { priorMonth } from '../budget-suggestions.service';

const big = (value: number) => new Big(value);

describe('budget suggestions', () => {
  describe('medianOf', () => {
    it('ignores an outlier month', () => {
      expect(medianOf([big(100), big(100), big(1000)]).toNumber()).toBe(100);
    });

    it('averages the two middle months for an even count', () => {
      expect(medianOf([big(80), big(100), big(120), big(1000)]).toNumber()).toBe(110);
    });

    it('is zero with no months', () => {
      expect(medianOf([]).toNumber()).toBe(0);
    });
  });

  describe('roundUpToNearestFive', () => {
    it.each([
      [0, 0],
      [1, 5],
      [5, 5],
      [101, 105],
      [105, 105],
      [106, 110],
    ])('rounds %s up to %s', (input, expected) => {
      expect(roundUpToNearestFive(big(input)).toNumber()).toBe(expected);
    });
  });

  describe('summarizeBudgetSuggestions', () => {
    const categories = [{ categoryKey: 10, categoryName: 'Groceries' }];
    const month = (values: number[]) => ({
      byCategory: new Map(values.map((value) => [10, value])),
      month: '2026-01',
    });

    it('suggests the median of complete months, rounded up to five, with the average beside it', () => {
      const [suggestion] = summarizeBudgetSuggestions({
        categories,
        months: [month([100]), month([100]), month([1000])],
      });

      expect(suggestion).toMatchObject({
        average: 400,
        categoryKey: 10,
        categoryName: 'Groceries',
        hasEnoughData: true,
        median: 100,
        monthsWithData: 3,
        suggested: 100,
      });
    });

    it('counts a month the category did not appear in as zero spending', () => {
      const [suggestion] = summarizeBudgetSuggestions({
        categories,
        months: [month([100]), { byCategory: new Map(), month: '2026-02' }, month([100])],
      });

      expect(suggestion).toMatchObject({ average: 66.6667, median: 100, monthsWithData: 2, suggested: 100 });
    });

    it('flags a category with fewer than two months of data instead of suggesting', () => {
      const [suggestion] = summarizeBudgetSuggestions({
        categories,
        months: [month([100]), { byCategory: new Map(), month: '2026-02' }, { byCategory: new Map(), month: '2026-03' }],
      });

      expect(suggestion).toMatchObject({ hasEnoughData: false, monthsWithData: 1, suggested: null });
    });

    it('does not suggest a zero median', () => {
      const [suggestion] = summarizeBudgetSuggestions({
        categories,
        months: [month([0]), month([0]), month([0])],
      });

      expect(suggestion).toMatchObject({ hasEnoughData: false, suggested: null });
    });
  });

  describe('priorMonth', () => {
    it('walks back across a year boundary', () => {
      expect(priorMonth({ month: 1, year: 2027 }, 1)).toEqual({ month: 12, year: 2026 });
      expect(priorMonth({ month: 3, year: 2027 }, 3)).toEqual({ month: 12, year: 2026 });
    });
  });
});
