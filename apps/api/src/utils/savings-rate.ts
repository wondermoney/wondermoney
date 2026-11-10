import Big from 'big.js';

/** A money amount, or anything Big.js can read as one. */
export type SavingsRateInput = Big | number | string;

/**
 * The share of income left after spending: `(income - expenses) / income`.
 *
 * One helper for every surface that states a savings rate, so the dashboard,
 * the cash-flow report and the monthly email cannot disagree about the same
 * month.
 *
 * Null when income is zero or negative: there is no rate to state, rather than
 * an infinite or NaN one. Expenses may be negative in a month of net refunds,
 * in which case the rate is above 1.
 */
export function savingsRate(income: SavingsRateInput, expenses: SavingsRateInput): Big | null {
  const incomeValue = new Big(income);
  if (incomeValue.lte(0)) return null;
  return incomeValue.minus(new Big(expenses)).div(incomeValue);
}

/** The rate as a JSON number, to four decimal places (0.01 percentage points). */
export function savingsRateNumber(income: SavingsRateInput, expenses: SavingsRateInput): null | number {
  const rate = savingsRate(income, expenses);
  return rate === null ? null : Number(rate.toFixed(4));
}

/** The rate as a percentage with two decimals, the form the monthly email stores. */
export function savingsRatePercent(income: SavingsRateInput, expenses: SavingsRateInput): null | string {
  const rate = savingsRate(income, expenses);
  return rate === null ? null : rate.times(100).toFixed(2);
}
