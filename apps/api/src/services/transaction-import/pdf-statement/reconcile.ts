/**
 * The check a PDF statement carries itself: its opening balance plus every transaction on it is
 * its closing balance. A row the model missed, doubled or misread shows as a difference. It is
 * compared to the cent, in whole cents, so floating point never fakes a mismatch (or hides one).
 *
 * - `matched`: the balances add up.
 * - `mismatch`: they do not; `difference` is the closing balance less the opening balance and the
 *   rows, so a negative difference is money that left the account and no row shows.
 * - `unavailable`: the statement prints no opening or no closing balance, so nothing can be checked.
 */
export interface ReconcileInput {
  amounts: readonly number[];
  closingBalance: null | number;
  currency: null | string;
  openingBalance: null | number;
}

export interface StatementReconciliation {
  closingBalance: null | number;
  /** The statement's currency as printed; null when the pages name none. */
  currency: null | string;
  difference: null | number;
  openingBalance: null | number;
  /** The sum of the rows that read. */
  rowsTotal: number;
  status: StatementReconciliationStatus;
}

export type StatementReconciliationStatus = 'matched' | 'mismatch' | 'unavailable';

const cents = (value: number) => Math.round(value * 100);

export function reconcileStatement({ amounts, closingBalance, currency, openingBalance }: ReconcileInput): StatementReconciliation {
  const totalCents = amounts.reduce((sum, amount) => sum + cents(amount), 0);
  const rowsTotal = totalCents / 100;
  if (openingBalance === null || closingBalance === null) {
    return { closingBalance, currency, difference: null, openingBalance, rowsTotal, status: 'unavailable' };
  }
  const differenceCents = cents(closingBalance) - (cents(openingBalance) + totalCents);
  return { closingBalance, currency, difference: differenceCents / 100, openingBalance, rowsTotal, status: differenceCents === 0 ? 'matched' : 'mismatch' };
}
