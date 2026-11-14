/**
 * Day-first or month-first: reading the dates of a file that does not say which (QIF, a YNAB
 * register export).
 *
 * The reader looks at every date in the file: a first part above 12 makes the file day-first, a
 * second part above 12 makes it month-first, and a four-digit first part is ISO order (year,
 * month, day). When every date is ambiguous (both parts 12 or less) the file cannot say, so it
 * is read day-first and the reader reports `date_order_ambiguous`; the session asks the person and
 * reads the file again with `dateOrder`. Dates that disagree (one above 12 in each part) read
 * day-first and report `date_order_conflict`. Two-digit years are 2000-2049 for 00-49 and
 * 1950-1999 for 50-99, as Quicken writes them.
 */

/** How a date whose day and month are both 12 or less reads. */
export type DateOrder = 'day-first' | 'month-first';

export type DateKind = 'ambiguous' | 'day-first' | 'month-first' | 'unreadable' | 'year-first';

type DateShape = { day: number; kind: 'year-first'; month: number; year: number } | { first: number; kind: 'two-part'; second: number; year: number };

/** The three numbers of a date, with the year resolved; `undefined` when it is not a date at all. */
function shapeOf(value: string): DateShape | undefined {
  const parts = value
    .trim()
    .split(/['\-/.]/)
    .map((part) => part.trim());
  if (parts.length !== 3) return undefined;
  const [first, second, third] = parts;
  if (!/^\d{1,4}$/.test(first ?? '') || !/^\d{1,4}$/.test(second ?? '') || !/^\d{1,4}$/.test(third ?? '')) return undefined;
  const a = Number(first);
  const b = Number(second);
  const c = Number(third);
  // A four-digit first part is a year: the file is ISO-ordered (year, month, day).
  if ((first ?? '').length === 4) return { day: c, kind: 'year-first', month: b, year: a };
  const year = expandYear(c, (third ?? '').length);
  return year === undefined ? undefined : { first: a, kind: 'two-part', second: b, year };
}

/** Two-digit years: 00-49 are 2000-2049, 50-99 are 1950-1999. */
function expandYear(value: number, digits: number): number | undefined {
  if (digits >= 3) return value;
  if (value > 99) return undefined;
  return value < 50 ? 2000 + value : 1900 + value;
}

/** What one date says about the file's order. */
export function classifyDate(value: string): DateKind {
  const shape = shapeOf(value);
  if (!shape) return 'unreadable';
  if (shape.kind === 'year-first') return toDate(shape.year, shape.month, shape.day) ? 'year-first' : 'unreadable';
  if (shape.first > 12 && shape.second > 12) return 'unreadable';
  if (shape.first > 12) return 'day-first';
  if (shape.second > 12) return 'month-first';
  return 'ambiguous';
}

/** The date in `order` (an ISO-ordered date reads as such whatever the order), at UTC midnight. */
export function parseOrderedDate(value: string, order: DateOrder): Date | undefined {
  const shape = shapeOf(value);
  if (!shape) return undefined;
  if (shape.kind === 'year-first') return toDate(shape.year, shape.month, shape.day);
  const dayFirst = order === 'day-first';
  return toDate(shape.year, dayFirst ? shape.second : shape.first, dayFirst ? shape.first : shape.second);
}

function toDate(year: number, month: number, day: number): Date | undefined {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

/**
 * The order the file reads in. A date with a part above 12 settles it; when every date is
 * ambiguous the file cannot say, and `ambiguous` asks the person (reading day-first meanwhile).
 */
export function chooseDateOrder(kinds: ReadonlySet<DateKind>, option: DateOrder | undefined): { ambiguous: boolean; conflict: boolean; order: DateOrder } {
  if (option !== undefined) return { ambiguous: false, conflict: false, order: option };
  const dayFirst = kinds.has('day-first');
  const monthFirst = kinds.has('month-first');
  if (dayFirst && monthFirst) return { ambiguous: false, conflict: true, order: 'day-first' };
  if (monthFirst) return { ambiguous: false, conflict: false, order: 'month-first' };
  return { ambiguous: !dayFirst && kinds.has('ambiguous'), conflict: false, order: 'day-first' };
}

/**
 * The order for a file's dates, and the warning to report when the person did not choose one and
 * the dates cannot settle it.
 */
export function resolveDateOrder(dates: Iterable<string>, option: DateOrder | undefined): { order: DateOrder; warning?: { code: 'date_order_ambiguous' | 'date_order_conflict'; detail: DateOrder } } {
  const kinds = new Set<DateKind>();
  for (const date of dates) kinds.add(classifyDate(date));
  const { ambiguous, conflict, order } = chooseDateOrder(kinds, option);
  if (option === undefined && conflict) return { order, warning: { code: 'date_order_conflict', detail: order } };
  if (option === undefined && ambiguous) return { order, warning: { code: 'date_order_ambiguous', detail: order } };
  return { order };
}
