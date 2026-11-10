import { localCalendarDay } from "@/lib/utils/transaction-date";

/** Days in a month grid: six weeks, so the grid height never jumps between months. */
export const CALENDAR_CELL_COUNT = 42;

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, "0");

export interface CalendarDayTotal {
  /** Null when the day's bills are in more than one currency and none is preferred. */
  amount: number | null;
  count: number;
  currency: string | null;
}

/** The `YYYY-MM` key of a date, in the viewer's calendar. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** The `YYYY-MM` key `delta` months from `month`, crossing year boundaries. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = monthParts(month);
  return monthKey(new Date(year, monthIndex + delta, 1));
}

/** The month's name and year, in `locale`. */
export function monthLabel(month: string, locale?: string): string {
  const [year, monthIndex] = monthParts(month);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, monthIndex, 1));
}

/** The seven weekday headings, Monday first, in `locale`. */
export function weekdayLabels(locale?: string): string[] {
  // 2024-01-01 is a Monday; any Monday works as the anchor.
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 1 + index)));
}

/**
 * The `YYYY-MM-DD` keys of a month grid, Monday first: the whole of `month` plus the days of
 * the neighbouring months that fill the leading and trailing cells.
 */
export function calendarDays(month: string): string[] {
  const [year, monthIndex] = monthParts(month);
  const first = new Date(year, monthIndex, 1);
  // getDay(): Sunday is 0. Shift so Monday is 0.
  const leading = (first.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - leading);
  return Array.from({ length: CALENDAR_CELL_COUNT }, (_, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  });
}

/** The `YYYY-MM-DD` day an occurrence falls on, as the transaction it comes from is shown. */
export function occurrenceDay(value: Date | string): string {
  return localCalendarDay(value);
}

/** Occurrences grouped by the day they fall on, each group in date order. */
export function groupOccurrencesByDay<T extends { date: Date | string }>(items: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const day = occurrenceDay(item.date);
    const list = grouped.get(day) ?? [];
    list.push(item);
    grouped.set(day, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  }
  return grouped;
}

/**
 * A day's total, in one currency. When the day mixes currencies the total is not honest, so it
 * is null and the caller shows the item count instead.
 */
export function dayTotal(
  items: readonly { currency?: string | null; expectedAmount?: number | null }[],
): CalendarDayTotal {
  const currencies = new Set<string>();
  for (const item of items) {
    if (typeof item.currency === "string" && item.currency) currencies.add(item.currency);
  }
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  if (!currency) return { amount: null, count: items.length, currency: null };
  const amount = items.reduce(
    (total, item) =>
      item.currency === currency && typeof item.expectedAmount === "number" && Number.isFinite(item.expectedAmount)
        ? total + item.expectedAmount
        : total,
    0,
  );
  return { amount, count: items.length, currency };
}

function monthParts(month: string): [number, number] {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error(`Expected a YYYY-MM month, received "${month}"`);
  return [Number(match[1]), Number(match[2]) - 1];
}
