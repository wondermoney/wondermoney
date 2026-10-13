export type AccountsTimeframe = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

export interface AccountsTimeframeRange {
  fromDate?: Date;
  toDate?: Date;
}

export function getAccountsTimeframeRange(
  timeframe: AccountsTimeframe,
  now = new Date(),
): AccountsTimeframeRange {
  switch (timeframe) {
    case "1M":
      return {
        fromDate: subUtcMonths(now, 1),
        toDate: now,
      };
    case "3M":
      return {
        fromDate: subUtcMonths(now, 3),
        toDate: now,
      };
    case "6M":
      return {
        fromDate: subUtcMonths(now, 6),
        toDate: now,
      };
    case "YTD":
      return {
        fromDate: startOfUtcYear(now),
        toDate: now,
      };
    case "1Y":
      return {
        fromDate: subUtcMonths(now, 12),
        toDate: now,
      };
    case "ALL":
      return {};
  }
}

function startOfUtcYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function subUtcMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() - months,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}
