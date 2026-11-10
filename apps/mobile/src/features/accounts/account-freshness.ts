import type { AccountSummaryViewModel } from './accounts-view-model'

export type Freshness = Readonly<{ updatedAt: string; isStale: boolean; hasError: boolean }>

/**
 * Web's `getAggregateFreshness`: a total is only as current as its stalest
 * part, so the *oldest* sync time wins. Manual accounts carry no sync time and
 * are left out; an all-manual set has no "as of" and returns null.
 */
export function aggregateFreshness(accounts: readonly AccountSummaryViewModel[]): Freshness | null {
  const times = accounts
    .map((account) => account.lastSyncedAt ?? account.refreshedAt)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .map((value) => Date.parse(value))
  if (!times.length) return null
  return {
    updatedAt: new Date(Math.min(...times)).toISOString(),
    isStale: accounts.some((account) => account.syncStaleness === 'stale' || account.syncStaleness === 'very_stale'),
    hasError: accounts.some((account) => account.syncStaleness === 'error'),
  }
}

export function accountFreshness(account: AccountSummaryViewModel): Freshness | null {
  const value = account.lastSyncedAt ?? account.refreshedAt
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return {
    updatedAt: value,
    isStale: account.syncStaleness === 'stale' || account.syncStaleness === 'very_stale',
    hasError: false,
  }
}
