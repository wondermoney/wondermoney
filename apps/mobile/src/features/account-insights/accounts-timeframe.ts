import type { DateScope } from './insights-contract'

/** Web's accounts timeframe select (`accounts-timeframe.ts`): 1M · 3M · 6M · YTD · 1Y · All. */
export const ACCOUNTS_TIMEFRAMES = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const
export type AccountsTimeframe = (typeof ACCOUNTS_TIMEFRAMES)[number]
export const DEFAULT_ACCOUNTS_TIMEFRAME: AccountsTimeframe = 'YTD'

/** Local midnight of the same day `months` earlier, or of that month's last day when it is shorter (date-fns `subMonths`). */
function startOfDayMonthsBack(date: Date, months: number): Date {
  const start = new Date(date.getFullYear(), date.getMonth() - months, 1)
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  start.setDate(Math.min(date.getDate(), lastDay))
  return start
}

function endOfDay(date: Date): Date {
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return end
}

/**
 * The range web sends for a timeframe, on the device's calendar: whole local days from months
 * back (or 1 January for YTD) to the end of today, and no lower bound for "All Time". The
 * endpoints get the device's time zone with it, so a date-only booking counts on its own date.
 * Memoize the result per timeframe: `now` feeds the query keys.
 */
export function getAccountsTimeframeScope(timeframe: AccountsTimeframe, now = new Date()): DateScope {
  const toDate = endOfDay(now).toISOString()
  switch (timeframe) {
    case '1M': return { fromDate: startOfDayMonthsBack(now, 1).toISOString(), toDate }
    case '3M': return { fromDate: startOfDayMonthsBack(now, 3).toISOString(), toDate }
    case '6M': return { fromDate: startOfDayMonthsBack(now, 6).toISOString(), toDate }
    case 'YTD': return { fromDate: new Date(now.getFullYear(), 0, 1).toISOString(), toDate }
    case '1Y': return { fromDate: startOfDayMonthsBack(now, 12).toISOString(), toDate }
    case 'ALL': return { toDate }
  }
}
