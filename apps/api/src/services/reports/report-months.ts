/**
 * RAD-555 — calendar-month bucketing for report aggregations.
 *
 * Report date filters are applied to *instants* (`transactionDate >= fromDate`),
 * but a cash flow row is a *calendar month*. The two only agree when the month
 * is computed in the same calendar the caller used to pick the period.
 *
 * Bucketing in UTC while filtering on instants is the defect RAD-555 reports.
 * A viewer at UTC+1 picking "August" sends `fromDate=2026-07-31T23:00:00Z`, so a
 * transaction in the first hour of *their* August lands in UTC **July** and the
 * response carries a month outside the selected period holding an hour's worth
 * of money. The mirror case applies at the end of the range.
 *
 * ## The assumed time zone
 *
 * We bucket in the caller's calendar, which means we need to know it. Nothing in
 * the request carries one today: clients serialise the filter dates with
 * `Date#toISOString()`, so `fromDate`/`toDate` always arrive as `Z` even though
 * the schema permits an offset, and there is no time-zone column on `Appuser` or
 * `Tenant`. Callers can now state it explicitly with the `timezone` report
 * filter (IANA name).
 *
 * When it is absent we fall back to {@link REPORT_DEFAULT_TIME_ZONE}. **That is
 * a product assumption, not a derived fact.** It is the same assumption every
 * other money-by-month aggregation in this API already makes — budget
 * aggregation periods (`services/budget/aggregation-periods.ts`), the
 * financial-email queue, and the lifecycle emails all bucket in `Europe/Lisbon`
 * — so cash flow now agrees with them rather than inventing a third calendar.
 * A caller outside that zone should send `timezone` to be exactly right.
 */

/**
 * Calendar assumed when a caller does not send `timezone`.
 *
 * Matches `FINANCIAL_EMAIL_TIME_ZONE` and the budget aggregation periods.
 */
export const REPORT_DEFAULT_TIME_ZONE = 'Europe/Lisbon';

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `YYYY-MM` for `instant` read in `timeZone`.
 *
 * `Intl` owns the offset rules, so DST transitions inside the reporting period
 * are handled without a fixed-offset approximation. Zero-padded, so the keys
 * also sort chronologically as plain strings.
 */
export function getMonthKey(instant: Date, timeZone: string): string {
  const parts = getMonthFormatter(timeZone).formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}`;
}

/**
 * Month label for a `YYYY-MM` key: UTC midnight on the 1st.
 *
 * Deliberately *not* the zoned instant. The label is a floating calendar month,
 * and every consumer reads it back with `getUTCFullYear()`/`getUTCMonth()` —
 * including the shipped web chart (`web/lib/reports/cashflow-series.ts`).
 * Emitting `2026-07-31T23:00:00.000Z` for a Lisbon August would read as July
 * there, which is the very bug this module exists to remove.
 */
export function getMonthStartIso(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1)).toISOString();
}

/** True when `value` is an IANA name `Intl` can resolve on this runtime. */
export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar to bucket in: the caller's when they sent a usable one, the
 * assumed default otherwise. Re-checks validity so a filter object built outside
 * the zod schema can never reach `Intl` with a name that throws.
 */
export function resolveReportTimeZone(value: string | undefined): string {
  if (value !== undefined && isSupportedTimeZone(value)) return value;
  return REPORT_DEFAULT_TIME_ZONE;
}

function getMonthFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = monthFormatters.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', { month: '2-digit', timeZone, year: 'numeric' });
  monthFormatters.set(timeZone, formatter);
  return formatter;
}
