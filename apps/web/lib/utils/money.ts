/**
 * An amount with its currency, as the API sends it (balances are `numeric(18,4)`).
 * `null` is an amount the API could not provide, such as a balance it could not convert.
 */
export interface MoneyValue {
  amount: number | null;
  currency: string;
}

/** Adding amounts in two currencies gives a number that means nothing. */
export class CurrencyMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Cannot add a ${actual} amount to a ${expected} total`);
    this.name = "CurrencyMismatchError";
  }
}

/** The API's money scale: amounts are exact at 4 decimal places. */
const SCALE = 10_000;

/**
 * The total of `values`, all of which must be in `currency`. Throws
 * {@link CurrencyMismatchError} for an amount in any other currency, and
 * returns null when any amount is unknown, so a partial total is never shown
 * as a whole one. Sums in integer ten-thousandths, so it does not drift.
 */
export function sumMoney(
  values: MoneyValue[],
  currency: string,
): number | null {
  let total = 0;
  for (const value of values) {
    if (value.currency !== currency) {
      throw new CurrencyMismatchError(currency, value.currency);
    }
    if (value.amount === null) return null;
    total += Math.round(value.amount * SCALE);
  }
  return total / SCALE;
}
