import { expectedOccurrenceAmount } from './recurring-expectation';
import { type RecurringAmountType, RecurringCadence, RecurringOccurrenceMatchStatus } from './recurring-types';

/**
 * The widest range the occurrences endpoint accepts, in whole days. Two months covers a month
 * grid with its leading and trailing days from the neighbouring months, and keeps one request
 * from expanding years of a weekly series.
 */
export const MAX_RECURRING_OCCURRENCE_RANGE_DAYS = 62;

const DAY_MS = 86_400_000;
/** A range is bounded, so this only stops a corrupt cadence from looping forever. */
const MAX_STEPS = 500;

export type RecurringOccurrenceStatus = 'due' | 'overdue' | 'paid' | 'projected';

/** The series fields the schedule reads; a full `RecurringSeries` satisfies it. */
export interface RecurringScheduleSeries {
  amountType: RecurringAmountType;
  averageAmount?: null | number;
  cadence: RecurringCadence;
  currency?: null | string;
  displayName: string;
  expectedAmount?: null | number;
  expectedAmountMax?: null | number;
  nextExpectedAt?: Date | null;
  recurringSeriesKey: number;
}

/** A `RecurringOccurrence` row, already scoped to its series. */
export interface RecurringScheduleEntry {
  currency: null | string;
  date: Date;
  expectedAmount: null | number;
  name: string;
  seriesKey: number;
  status: RecurringOccurrenceStatus;
}

export interface RecurringScheduleOccurrence {
  amount?: null | number;
  currency?: null | string;
  date: Date;
  matchStatus: RecurringOccurrenceMatchStatus;
  seriesKey: number;
}

export interface RecurringScheduleRange {
  from: Date;
  to: Date;
  /** The day the statuses are judged against. Defaults to now. */
  today?: Date;
}

/**
 * Every expected date of `series` inside `[from, to]`, as UTC midnights.
 *
 * The series stores only its next expected date and a cadence, so the schedule is walked out
 * from that date in both directions: forward for the future, back for a range that starts
 * before it. A monthly series keeps the day of month it is anchored on and clamps to the end of
 * a shorter month (the 31st falls on the 28th of February and returns to the 31st in March).
 */
export function expandRecurringSchedule(
  series: Pick<RecurringScheduleSeries, 'cadence' | 'nextExpectedAt'>,
  from: Date,
  to: Date,
): Date[] {
  const next = series.nextExpectedAt;
  if (!next || !Number.isFinite(next.getTime())) return [];
  const start = startOfUtcDay(from);
  const end = endOfUtcDay(to);
  if (start.getTime() > end.getTime()) return [];

  const anchorDay = next.getUTCDate();
  let cursor = next;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const previous = shift(cursor, series.cadence, -1, anchorDay);
    if (previous.getTime() < start.getTime()) break;
    cursor = previous;
  }

  const dates: Date[] = [];
  for (let step = 0; step < MAX_STEPS && cursor.getTime() <= end.getTime(); step += 1) {
    if (cursor.getTime() >= start.getTime()) dates.push(startOfUtcDay(cursor));
    cursor = shift(cursor, series.cadence, 1, anchorDay);
  }
  return dates;
}

/**
 * The calendar entries for a set of series: a paid entry on the day each matched payment landed,
 * and due, overdue or projected entries for expected dates with no payment. A payment is matched
 * to the nearest expected date within a cadence-sized window, so a bill paid a few days late is
 * still that cycle's payment and never settles two cycles.
 */
export function buildRecurringSchedule(
  seriesList: readonly RecurringScheduleSeries[],
  occurrences: readonly RecurringScheduleOccurrence[],
  range: RecurringScheduleRange,
): RecurringScheduleEntry[] {
  const start = startOfUtcDay(range.from);
  const end = endOfUtcDay(range.to);
  const today = startOfUtcDay(range.today ?? new Date());
  const paidBySeries = groupPaidOccurrences(occurrences);
  const entries: RecurringScheduleEntry[] = [];

  for (const series of seriesList) {
    const paid = paidBySeries.get(series.recurringSeriesKey) ?? [];
    const used = new Set<number>();
    const window = matchWindowDays(series.cadence) * DAY_MS;
    const expectedAmount = expectedOccurrenceAmount({
      amountType: series.amountType,
      averageAmount: series.averageAmount ?? undefined,
      expectedAmount: series.expectedAmount ?? undefined,
      expectedAmountMax: series.expectedAmountMax ?? undefined,
    });

    for (const expected of expandRecurringSchedule(series, range.from, range.to)) {
      const match = nearestUnusedPayment(paid, used, expected, window);
      const occurrence = match === -1 ? undefined : paid[match];
      if (occurrence) {
        used.add(match);
        entries.push(entry(series, occurrence.date, 'paid', occurrence.amount ?? expectedAmount, occurrence.currency ?? series.currency));
        continue;
      }
      const expectedDay = startOfUtcDay(expected).getTime();
      const status: RecurringOccurrenceStatus = expectedDay < today.getTime()
        ? 'overdue'
        : expectedDay === today.getTime()
          ? 'due'
          : 'projected';
      entries.push(entry(series, expected, status, expectedAmount, series.currency));
    }

    paid.forEach((occurrence, index) => {
      if (used.has(index)) return;
      if (occurrence.date.getTime() < start.getTime() || occurrence.date.getTime() > end.getTime()) return;
      entries.push(entry(series, occurrence.date, 'paid', occurrence.amount ?? expectedAmount, occurrence.currency ?? series.currency));
    });
  }

  return entries.sort((left, right) =>
    left.date.getTime() - right.date.getTime()
    || left.name.localeCompare(right.name)
    || left.seriesKey - right.seriesKey);
}

function endOfUtcDay(date: Date): Date {
  const day = startOfUtcDay(date);
  return new Date(day.getTime() + DAY_MS - 1);
}

function entry(
  series: RecurringScheduleSeries,
  date: Date,
  status: RecurringOccurrenceStatus,
  expectedAmount: null | number,
  currency: null | string | undefined,
): RecurringScheduleEntry {
  return {
    currency: currency ?? null,
    date,
    expectedAmount: expectedAmount ?? null,
    name: series.displayName,
    seriesKey: series.recurringSeriesKey,
    status,
  };
}

function groupPaidOccurrences(occurrences: readonly RecurringScheduleOccurrence[]) {
  const grouped = new Map<number, RecurringScheduleOccurrence[]>();
  for (const occurrence of occurrences) {
    if (!isPaid(occurrence) || !Number.isFinite(occurrence.date.getTime())) continue;
    const list = grouped.get(occurrence.seriesKey) ?? [];
    list.push(occurrence);
    grouped.set(occurrence.seriesKey, list);
  }
  for (const list of grouped.values()) list.sort((left, right) => left.date.getTime() - right.date.getTime());
  return grouped;
}

function isPaid(occurrence: RecurringScheduleOccurrence): boolean {
  return occurrence.matchStatus === RecurringOccurrenceMatchStatus.matched
    || occurrence.matchStatus === RecurringOccurrenceMatchStatus.manual_added;
}

/** Half a cadence, capped so a monthly bill paid ten days late still settles its own cycle. */
function matchWindowDays(cadence: RecurringCadence): number {
  switch (cadence) {
    case RecurringCadence.biweekly:
      return 7;
    case RecurringCadence.monthly:
    case RecurringCadence.quarterly:
    case RecurringCadence.yearly:
      return 10;
    case RecurringCadence.weekly:
      return 3;
  }
}

function nearestUnusedPayment(
  paid: readonly RecurringScheduleOccurrence[],
  used: ReadonlySet<number>,
  expected: Date,
  window: number,
): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  paid.forEach((occurrence, index) => {
    if (used.has(index)) return;
    const distance = Math.abs(startOfUtcDay(occurrence.date).getTime() - startOfUtcDay(expected).getTime());
    if (distance > window) return;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function shift(date: Date, cadence: RecurringCadence, direction: -1 | 1, anchorDay: number): Date {
  switch (cadence) {
    case RecurringCadence.biweekly:
      return new Date(date.getTime() + direction * 14 * DAY_MS);
    case RecurringCadence.monthly:
      return addMonths(date, direction, anchorDay);
    case RecurringCadence.quarterly:
      return addMonths(date, direction * 3, anchorDay);
    case RecurringCadence.weekly:
      return new Date(date.getTime() + direction * 7 * DAY_MS);
    case RecurringCadence.yearly:
      return addMonths(date, direction * 12, anchorDay);
  }
}

/** Add months keeping the anchor day of month, clamped to the target month's last day. */
function addMonths(date: Date, months: number, anchorDay: number): Date {
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    1,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
  target.setUTCDate(Math.min(anchorDay, daysInMonth(target.getUTCFullYear(), target.getUTCMonth())));
  return target;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
