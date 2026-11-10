import { endOfDay, startOfDay } from "date-fns";

import { resolveViewerTimeZone } from "@/lib/reports/viewer-timezone";

export interface DateRange {
  fromDate?: Date;
  toDate?: Date;
}

export interface DateRangeParams {
  fromDate?: string;
  toDate?: string;
}

/**
 * The query params for a date range the API filters as instants (transaction lists, money in and
 * out, cash flow, category spending, portfolio transactions, reports).
 *
 * Convention: a range is whole days on the viewer's calendar. `fromDate` is the first instant of
 * the first day and `toDate` the last instant (23:59:59.999) of the last day, both in the device's
 * time zone, sent as ISO 8601 timestamps in UTC (`toISOString()`). So a range ending today includes
 * everything dated today, and a viewer east or west of UTC gets the days they picked. The time of
 * day of the dates passed in is ignored. An open end is left out, so the API applies its default.
 *
 * Never send a bare `yyyy-MM-dd` for such a range: the API reads it as UTC midnight, which cut a
 * range ending today at the start of the day and shifted the start by the viewer's UTC offset.
 *
 * The transaction endpoints take the viewer's time zone too: use {@link transactionDateRangeParams}.
 *
 * Not for parameters that name a calendar date or month rather than an instant: portfolio
 * snapshot dates (`getPortfolioFromDate`), net worth `toDate`, market data `from`/`to`, budgets
 * by year and month, and `period` presets keep their own formats.
 *
 * Runs wherever it is called: on the server it uses the server's time zone, as the transaction
 * list's server prefetch always has.
 */
export function dateRangeParams({ fromDate, toDate }: DateRange): DateRangeParams {
  return {
    ...(fromDate && { fromDate: startOfDay(fromDate).toISOString() }),
    ...(toDate && { toDate: endOfDay(toDate).toISOString() }),
  };
}

export interface TransactionDateRangeParams extends DateRangeParams {
  timezone?: string;
}

/**
 * {@link dateRangeParams} for the transaction endpoints (transaction lists, money in and out, cash
 * flow, category spending), plus the viewer's IANA time zone. A bank booking has a date and no
 * time; with the time zone the API counts it on that date's calendar day, so a viewer west or east
 * of UTC sees the first and last day's bookings and not the next day's.
 *
 * The time zone is left out when there is no range, and on the server, where the viewer's is
 * unknown ({@link resolveViewerTimeZone}); the API then compares every row as an instant.
 */
export function transactionDateRangeParams(
  range: DateRange,
  timeZone: string | undefined = resolveViewerTimeZone(),
): TransactionDateRangeParams {
  const params = dateRangeParams(range);
  const hasRange = params.fromDate !== undefined || params.toDate !== undefined;
  return hasRange && timeZone ? { ...params, timezone: timeZone } : params;
}
