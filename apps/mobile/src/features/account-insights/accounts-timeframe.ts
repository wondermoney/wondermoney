import type { DateScope } from './insights-contract'

/** Web's accounts timeframe select (`accounts-timeframe.ts`): 1M · 3M · 6M · YTD · 1Y · All. */
export const ACCOUNTS_TIMEFRAMES = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const
export type AccountsTimeframe = (typeof ACCOUNTS_TIMEFRAMES)[number]
export const DEFAULT_ACCOUNTS_TIMEFRAME: AccountsTimeframe = 'YTD'

const subUtcMonths = (date: Date, months: number) => new Date(Date.UTC(
  date.getUTCFullYear(),
  date.getUTCMonth() - months,
  date.getUTCDate(),
  date.getUTCHours(),
  date.getUTCMinutes(),
  date.getUTCSeconds(),
  date.getUTCMilliseconds(),
))

/**
 * The same ranges web computes: months back in UTC, the year from 1 January
 * UTC, and no lower bound for "All Time". Memoize the result per timeframe:
 * `now` feeds the query keys.
 */
export function getAccountsTimeframeScope(timeframe: AccountsTimeframe, now = new Date()): DateScope {
  const toDate = now.toISOString()
  switch (timeframe) {
    case '1M': return { fromDate: subUtcMonths(now, 1).toISOString(), toDate }
    case '3M': return { fromDate: subUtcMonths(now, 3).toISOString(), toDate }
    case '6M': return { fromDate: subUtcMonths(now, 6).toISOString(), toDate }
    case 'YTD': return { fromDate: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), toDate }
    case '1Y': return { fromDate: subUtcMonths(now, 12).toISOString(), toDate }
    case 'ALL': return { toDate }
  }
}
