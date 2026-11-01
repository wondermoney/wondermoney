/**
 * Available balance.
 *
 * `balance` is the settled/current balance (pending rows never enter the stored running ledger —
 * putting unsettled amounts into historical per-row balances would corrupt them). "Available" is
 * the bank-app number the user actually spends against: current balance net of everything pending.
 * Computed at read time, never stored.
 *
 * Pending amounts are already signed (outflows negative, inflows positive), so available is just
 * the current balance plus their sum.
 */
export function computeAvailableBalance(currentBalance: null | number | undefined, pendingAmounts: (null | number | undefined)[]): number {
  const pendingSum = pendingAmounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  return (currentBalance ?? 0) + pendingSum;
}
