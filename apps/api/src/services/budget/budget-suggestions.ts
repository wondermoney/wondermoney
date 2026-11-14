import { Big } from 'big.js';

import { big, toNumber } from '@utils/money';

/** A category the budget plans for, as the suggestion names it. */
export interface BudgetSuggestionCategory {
  categoryKey: number;
  categoryName: string;
}

/**
 * A category's suggested monthly limit from the household's own complete months of spending.
 */
export interface BudgetSuggestion {
  /** Mean monthly spending across the complete months in the window. */
  average: number;
  categoryKey: number;
  categoryName: string;
  /** False when the category has fewer than {@link MIN_MONTHS_WITH_DATA} months of spending. */
  hasEnoughData: boolean;
  /** Median monthly spending across the complete months in the window. */
  median: number;
  monthsWithData: number;
  /** The median rounded up to the nearest 5, or null when there is nothing to suggest. */
  suggested: null | number;
}

/**
 * One complete month in the suggestion window: net spending per category, in the budget's
 * currency and already floored at zero (a refund-only month spent nothing), as the budget
 * spending query reports it.
 */
export interface BudgetSuggestionMonth {
  /** Net spending per category key. */
  byCategory: Map<number, number>;
  /** `YYYY-MM`. */
  month: string;
}

/** A category needs spending in at least two complete months before it is suggested. */
export const MIN_MONTHS_WITH_DATA = 2;

/** Suggestions are whole currency amounts in multiples of five. */
const SUGGESTION_STEP = 5;

/** The median of `values`; 0 for an empty list. Even counts average the two middle values. */
export function medianOf(values: Big[]): Big {
  if (values.length === 0) return new Big(0);
  const sorted = [...values].sort((left, right) => left.cmp(right));
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? new Big(0);
  return (sorted[middle - 1] ?? new Big(0)).plus(sorted[middle] ?? new Big(0)).div(2);
}

/** Round a positive amount up to the next multiple of five; 0 and negatives stay 0. */
export function roundUpToNearestFive(value: Big): Big {
  if (value.lte(0)) return new Big(0);
  return value.div(SUGGESTION_STEP).round(0, Big.roundUp).times(SUGGESTION_STEP);
}

/**
 * Per-category suggestions from complete months of spending. A category missing from a month
 * spent nothing that month, so the month still counts in the average and median; `monthsWithData`
 * counts only the months with spending, and a category below {@link MIN_MONTHS_WITH_DATA} is
 * flagged instead of suggested.
 */
export function summarizeBudgetSuggestions(input: {
  categories: BudgetSuggestionCategory[];
  months: BudgetSuggestionMonth[];
}): BudgetSuggestion[] {
  return input.categories.map((category) => {
    const values = input.months.map((month) => big(month.byCategory.get(category.categoryKey) ?? 0));
    const monthsWithData = values.filter((value) => value.gt(0)).length;
    const total = values.reduce((sum, value) => sum.plus(value), new Big(0));
    const average = values.length > 0 ? total.div(values.length) : new Big(0);
    const median = medianOf(values);
    const hasEnoughData = monthsWithData >= MIN_MONTHS_WITH_DATA;
    return {
      average: toNumber(average),
      categoryKey: category.categoryKey,
      categoryName: category.categoryName,
      hasEnoughData,
      median: toNumber(median),
      monthsWithData,
      suggested: hasEnoughData && median.gt(0) ? toNumber(roundUpToNearestFive(median)) : null,
    };
  });
}
