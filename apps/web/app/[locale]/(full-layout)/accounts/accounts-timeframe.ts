import { startOfDay, startOfYear, subMonths } from "date-fns";

export type AccountsTimeframe = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

export interface AccountsTimeframeRange {
  fromDate?: Date;
  toDate?: Date;
}

/**
 * The accounts page's range for a timeframe, on the viewer's calendar: months back from today
 * (the same day of an earlier month, or its last day when that month is shorter), or the year
 * from 1 January, from the start of that local day to now. The hooks send it as whole local days
 * with the viewer's time zone (`transactionDateRangeParams`), so a date-only booking counts on its
 * own date. "All Time" has no dates.
 */
export function getAccountsTimeframeRange(
  timeframe: AccountsTimeframe,
  now = new Date(),
): AccountsTimeframeRange {
  switch (timeframe) {
    case "1M":
      return { fromDate: monthsBack(now, 1), toDate: now };
    case "3M":
      return { fromDate: monthsBack(now, 3), toDate: now };
    case "6M":
      return { fromDate: monthsBack(now, 6), toDate: now };
    case "YTD":
      return { fromDate: startOfYear(now), toDate: now };
    case "1Y":
      return { fromDate: monthsBack(now, 12), toDate: now };
    case "ALL":
      return {};
  }
}

function monthsBack(date: Date, months: number): Date {
  return startOfDay(subMonths(date, months));
}
