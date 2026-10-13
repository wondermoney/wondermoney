import type { Account } from "@/lib/api/account/useAccounts";

export interface AggregateFreshness {
  /** The oldest sync among synced accounts — see below. */
  oldestSyncedAt: Date;
  /** How many accounts contributed a sync time. */
  syncedCount: number;
  /** At least one connection is in an error state. */
  hasError: boolean;
  /** At least one connection is stale or very stale. */
  isStale: boolean;
}

/**
 * How fresh an aggregate over several accounts actually is.
 *
 * The rule is **the oldest, not the newest**. A total balance summed from five
 * accounts is only as current as its stalest component: if four synced a
 * minute ago and one synced last Tuesday, the total is a Tuesday number
 * wearing a one-minute-old label. Reporting the newest would be the flattering
 * answer and the wrong one.
 *
 * Manual accounts contribute no sync time and are excluded rather than counted
 * as infinitely stale — they are user-maintained, not broken. If nothing in
 * the set is synced this returns `null` and the caller says nothing, because
 * an all-manual total has no meaningful "as of".
 */
export function getAggregateFreshness(
  accounts: Account[] | undefined,
): AggregateFreshness | null {
  if (!accounts?.length) return null;

  const timestamps = accounts
    .map((account) => account.syncStatus?.lastSyncedAt ?? account.refreshedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (!timestamps.length) return null;

  return {
    oldestSyncedAt: new Date(
      Math.min(...timestamps.map((date) => date.getTime())),
    ),
    syncedCount: timestamps.length,
    hasError: accounts.some(
      (account) => account.syncStatus?.staleness === "error",
    ),
    isStale: accounts.some(
      (account) =>
        account.syncStatus?.staleness === "stale" ||
        account.syncStatus?.staleness === "very_stale",
    ),
  };
}
