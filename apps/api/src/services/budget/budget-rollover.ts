import { big, toNumber } from '@utils/money';

/** One stored month of one budget category, with what the budget's spending figures say it spent. */
export interface RolloverMonthInput {
  budgeted: number;
  month: number;
  rolloverEnabled: boolean;
  /** False when some of the month's spending could not be converted into the budget's currency. */
  spendingComplete: boolean;
  /** The month's spending as the budget shows it (`spending.ts`): net of refunds, never below zero. */
  spent: number;
  year: number;
}

export interface RolloverMonthResult {
  /** `budgeted + rolledOver`: what the month may spend. */
  available: number;
  month: number;
  /** What the month before left over (negative when it overspent); 0 when nothing carries in. */
  rolledOver: number;
  /**
   * The carried amount rests on a month whose spending is incomplete (a row with no rate into the
   * budget's currency). That spending is left out, so the carry may be too high.
   */
  rolledOverIncomplete: boolean;
  year: number;
}

export interface RolloverOptions {
  /** False caps the carry at zero: a surplus moves forward, an overspend is dropped. */
  carryOverspend: boolean;
}

/**
 * Budget rollover for one category, over its stored months.
 *
 * A month carries into the next one only when both have rollover on and are consecutive calendar
 * months (December into January included). Then
 *
 *   carry(n)     = available(n-1) - spent(n-1)     (at least 0 when overspend is not carried)
 *   available(n) = budgeted(n) + carry(n)
 *
 * Anywhere else carry is 0: the first month of a chain, a month with rollover off, and a month
 * after a gap (no row) start from their own budget. A month with incomplete spending carries what
 * is known, and every month that carry reaches is flagged.
 */
export function computeRollover(months: readonly RolloverMonthInput[], options: RolloverOptions): RolloverMonthResult[] {
  const ordered = [...months].sort((left, right) => monthIndex(left) - monthIndex(right));
  const results: RolloverMonthResult[] = [];
  let previous: null | { available: ReturnType<typeof big>; incomplete: boolean; input: RolloverMonthInput } = null;

  for (const input of ordered) {
    const chained = previous != null && input.rolloverEnabled && previous.input.rolloverEnabled && monthIndex(input) === monthIndex(previous.input) + 1;
    let carry = big(0);
    let incomplete = false;
    if (chained && previous) {
      carry = previous.available.minus(big(previous.input.spent));
      if (!options.carryOverspend && carry.lt(0)) carry = big(0);
      incomplete = previous.incomplete || !previous.input.spendingComplete;
    }
    const available = big(input.budgeted).plus(carry);
    results.push({ available: toNumber(available), month: input.month, rolledOver: toNumber(carry), rolledOverIncomplete: incomplete, year: input.year });
    previous = { available, incomplete, input };
  }
  return results;
}

/** Months since year 0, so consecutive calendar months differ by one across a year boundary too. */
export function monthIndex({ month, year }: { month: number; year: number }): number {
  return year * 12 + (month - 1);
}
