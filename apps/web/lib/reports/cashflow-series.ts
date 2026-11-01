/**
 * Cash flow chart series assembly.
 *
 * `GET /v1/reports/cashflow` returns one row per month that actually has
 * transactions. Two things fall out of that which the chart must not render as
 * if they were facts:
 *
 * 1. **Out-of-period months.** The date filter is applied to instants, while the
 *    month bucket is a calendar month. When the two calendars disagree, a
 *    transaction in the first hour of the selected period lands in the previous
 *    bucket, so the response carries a month that sits outside the selected
 *    period holding a sliver of an amount. Next to real months it reads as ~0
 *    and drags the baseline down.
 * 2. **Missing months.** A month with no transactions is simply absent from the
 *    response. Plotted straight, Recharts closes the hole and joins the two
 *    neighbours as though they were consecutive — a silent lie about a month we
 *    have nothing to say about.
 *
 * This module rebuilds the series against the selected period: out-of-period
 * months are dropped, in-period months with no row become `null` (a gap, drawn
 * with `connectNulls={false}`), and a month whose row nets to zero keeps its
 * honest `0`. Absence and zero are distinguishable because the API only ever
 * emits a row when at least one transaction matched — `hasData` records which
 * side of that line each point is on.
 *
 * Months that are only partly covered — the current month, or a boundary month
 * the selected range cuts into — are flagged `isPartial` so the UI can say so
 * rather than presenting a month-to-date figure as a month.
 *
 * ## Why the out-of-period drop is still needed
 *
 * The API buckets in the calendar the request names and the client names the
 * viewer's, so in the normal case (1) cannot happen
 * and the drop is inert. It is kept because the client is allowed not to know:
 * when `Intl` cannot name a zone the `timezone` filter is deliberately omitted
 * and the API falls back to `Europe/Lisbon`, which is exactly the calendar
 * disagreement that produces the sliver for a reader an hour east. The drop is
 * the last line that still holds in that case. It is also the half that must not
 * be confused with the `null`/gap logic below, which is load-bearing regardless
 * of any calendar.
 */

import type { CashflowPoint } from "@/lib/api/reports/types";

const MONTHS_IN_YEAR = 12;

export interface CashflowSeriesPoint {
  /** `YYYY-MM` in the viewer's calendar. Stable key for lookups and tests. */
  monthKey: string;
  /** First instant of the month, ISO. The chart's x value. */
  month: string;
  /** `null` means "no data for this month", never "zero". */
  income: number | null;
  expenses: number | null;
  net: number | null;
  /** `false` when the report returned no row for this month at all. */
  hasData: boolean;
  /** The selected period, or elapsed time, covers only part of this month. */
  isPartial: boolean;
  /** Partial because the month has not finished yet. */
  isCurrentMonth: boolean;
}

/** The selected reporting period, as held in the report filter envelope. */
export interface CashflowSeriesRange {
  fromDate: string;
  toDate: string;
}

function toOrdinal(year: number, monthIndex: number): number {
  return year * MONTHS_IN_YEAR + monthIndex;
}

function ordinalParts(ordinal: number): { year: number; monthIndex: number } {
  return {
    year: Math.floor(ordinal / MONTHS_IN_YEAR),
    monthIndex: ordinal - Math.floor(ordinal / MONTHS_IN_YEAR) * MONTHS_IN_YEAR,
  };
}

/**
 * Period boundaries are read in the viewer's calendar: "from 1 June" means June
 * to the person who picked it, whatever UTC thinks of the instant.
 */
function localOrdinal(date: Date): number {
  return toOrdinal(date.getFullYear(), date.getMonth());
}

/**
 * Row labels are read in UTC, because that is how the API writes them:
 * `Date.UTC(year, month, 1)` for the bucket's calendar month, deliberately not
 * the zoned instant (see `api/src/services/reports/report-months.ts`). Reading
 * them any other way would shift a row into a month it was not computed for.
 */
function utcOrdinal(date: Date): number {
  return toOrdinal(date.getUTCFullYear(), date.getUTCMonth());
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKeyOf(ordinal: number): string {
  const { year, monthIndex } = ordinalParts(ordinal);
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/**
 * Rebuilds the monthly cash flow series for the selected period.
 *
 * @param points - Rows as returned by `GET /v1/reports/cashflow`
 * @param range - The selected period (the report filter envelope's dates)
 * @param now - Injectable clock, so "is this month still running?" is testable
 * @returns One point per month from the first to the last in-period month that
 *   has data, inclusive. Months in between with no data carry `null` values.
 *   Empty when the period is unusable or holds no data at all.
 */
export function buildCashflowSeries(
  points: CashflowPoint[] | undefined,
  range: CashflowSeriesRange,
  now: Date = new Date(),
): CashflowSeriesPoint[] {
  const from = parseDate(range.fromDate);
  const to = parseDate(range.toDate);
  if (!from || !to || from.getTime() > to.getTime()) return [];

  const periodStart = localOrdinal(from);
  const periodEnd = localOrdinal(to);

  const inPeriod = new Map<number, CashflowPoint>();
  for (const point of points ?? []) {
    const month = parseDate(point.month);
    if (!month) continue;
    const ordinal = utcOrdinal(month);
    if (ordinal < periodStart || ordinal > periodEnd) continue;
    inPeriod.set(ordinal, point);
  }
  if (inPeriod.size === 0) return [];

  // Span only the months the data actually reaches. Padding out to the whole
  // period would bury a three-month series inside a decade of empty months
  // under the "All time" preset, which is a different way of saying nothing.
  const occupied = [...inPeriod.keys()];
  const gridStart = Math.min(...occupied);
  const gridEnd = Math.max(...occupied);

  const currentMonth = localOrdinal(now);
  const observedEnd = Math.min(to.getTime(), now.getTime());

  const series: CashflowSeriesPoint[] = [];
  for (let ordinal = gridStart; ordinal <= gridEnd; ordinal += 1) {
    const { year, monthIndex } = ordinalParts(ordinal);
    const monthStart = new Date(year, monthIndex, 1);
    const lastInstant = new Date(year, monthIndex + 1, 1).getTime() - 1;
    const row = inPeriod.get(ordinal);

    series.push({
      monthKey: monthKeyOf(ordinal),
      month: monthStart.toISOString(),
      income: row ? row.income : null,
      expenses: row ? row.expenses : null,
      net: row ? row.net : null,
      hasData: row !== undefined,
      isPartial:
        from.getTime() > monthStart.getTime() || observedEnd < lastInstant,
      isCurrentMonth: ordinal === currentMonth,
    });
  }

  return series;
}

const TRAILING_MONTHS = 3;

/**
 * Mean net over the last months that have data. Gaps are skipped rather than
 * counted as zero — averaging in a month we know nothing about would understate
 * the run rate exactly when the user has the least data to spare.
 */
export function getTrailingNetAverage(series: CashflowSeriesPoint[]): number {
  const withData = series.filter((point) => point.net !== null);
  if (withData.length === 0) return 0;
  const last = withData.slice(-TRAILING_MONTHS);
  const sum = last.reduce((total, point) => total + (point.net ?? 0), 0);
  return sum / last.length;
}

/** The month the reader should be told is incomplete, if there is one. */
export function findPartialMonth(
  series: CashflowSeriesPoint[],
): CashflowSeriesPoint | undefined {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index];
    if (point.hasData && point.isPartial) return point;
  }
  return undefined;
}
