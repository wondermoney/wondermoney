/**
 * Credit-card statement cycles, as pure calendar arithmetic.
 *
 * A card closes its statement on one day of the month (`statementCloseDay`) and pays it on another
 * (`paymentDueDay`). This module answers one question — "which statement does this date belong
 * to?" — and nothing else, so the rule can be tested at month ends without a database, a
 * timezone or a controller in the way.
 *
 * ## The rules
 *
 * - A statement's period ends on its close day and starts the day after the previous month's
 *   close. A transaction **on** the close day belongs to the statement that closes that day.
 * - A close day of 31 (or 29, 30) is clamped to the month's last day, so a card closing on the
 *   31st closes on 28 February in a common year and 29 February in a leap year.
 * - The due date is the first `paymentDueDay` **after** the close. Closing on the 5th and paying
 *   on the 25th is due the same month; closing on the 20th and paying on the 10th is due the next.
 * - Every date is read and returned as a **UTC calendar day**. Bank rows are stored at a time of
 *   day that preserves their calendar day (12:00 UTC for OCR and CSV imports), so the day is what
 *   decides the statement, never the instant.
 */

const MS_PER_DAY = 86_400_000;

/** The card's cycle settings; both days are 1–31 and clamped to the month's last day. */
export interface CreditCardCycle {
  paymentDueDay: number;
  statementCloseDay: number;
}

/** One statement window. All three dates are UTC midnight of a calendar day. */
export interface StatementPeriod {
  /** The first day the statement counts, inclusive. */
  periodEnd: Date;
  /** The last day the statement counts, inclusive. */
  periodStart: Date;
  /** The day the statement must be paid. */
  dueDate: Date;
}

/** The UTC day number of a date's calendar day: consecutive integers for consecutive days. */
export function utcDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
}

/** A UTC midnight date for a calendar day, normalising an overflowing month index. */
function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/** The number of days in a month (`monthIndex` is 0-based, as everywhere in this module). */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** `day` clamped to the last day of the month, so a 31st becomes 28/29/30 where it must. */
export function clampDayToMonth(year: number, monthIndex: number, day: number): number {
  return Math.min(day, daysInMonth(year, monthIndex));
}

/** The date a card with `closeDay` closes in the given month, clamped to that month's end. */
export function closeDateFor(year: number, monthIndex: number, closeDay: number): Date {
  return utcDate(year, monthIndex, clampDayToMonth(year, monthIndex, closeDay));
}

/**
 * The first occurrence of `dueDay` strictly after `after`, clamped to the month's last day.
 * Closing on the 5th and paying on the 25th lands in the same month; closing on the 20th and
 * paying on the 10th lands in the next.
 */
export function dueDateAfter(after: Date, dueDay: number): Date {
  const afterDay = utcDayNumber(after);
  let year = after.getUTCFullYear();
  let monthIndex = after.getUTCMonth();
  let candidate = utcDate(year, monthIndex, clampDayToMonth(year, monthIndex, dueDay));
  if (utcDayNumber(candidate) <= afterDay) {
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    candidate = utcDate(year, monthIndex, clampDayToMonth(year, monthIndex, dueDay));
  }
  return candidate;
}

/**
 * The statement `date` belongs to. A transaction on the close day is in the statement closing that
 * day; the day after the close starts the next statement.
 */
export function statementForDate(cycle: CreditCardCycle, date: Date): StatementPeriod {
  const day = utcDayNumber(date);
  let year = date.getUTCFullYear();
  let monthIndex = date.getUTCMonth();
  // Past this month's close, the date is in the statement closing next month.
  if (day > utcDayNumber(closeDateFor(year, monthIndex, cycle.statementCloseDay))) {
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }
  const periodEnd = closeDateFor(year, monthIndex, cycle.statementCloseDay);
  const previousMonth = new Date(Date.UTC(year, monthIndex - 1, 1));
  const previousClose = closeDateFor(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), cycle.statementCloseDay);
  const periodStart = new Date(previousClose.getTime() + MS_PER_DAY);
  return { dueDate: dueDateAfter(periodEnd, cycle.paymentDueDay), periodEnd, periodStart };
}

/** Upper bound on the statements one window may return, so a bad range cannot spin forever. */
const MAX_STATEMENTS = 1_200;

/**
 * Every statement whose period overlaps `[from, to]`, oldest first. The statement containing
 * `from` is included even when it starts before it, so a partial window still totals a whole
 * statement.
 */
export function statementsBetween(cycle: CreditCardCycle, from: Date, to: Date): StatementPeriod[] {
  const statements: StatementPeriod[] = [];
  const lastDay = utcDayNumber(to);
  let current = statementForDate(cycle, from);
  while (statements.length < MAX_STATEMENTS && utcDayNumber(current.periodStart) <= lastDay) {
    statements.push(current);
    // The day after a close is the first day of the next statement.
    current = statementForDate(cycle, new Date(current.periodEnd.getTime() + MS_PER_DAY));
  }
  return statements;
}

/** Whether `date` falls inside the statement's period, close day included. */
export function isInStatement(period: StatementPeriod, date: Date): boolean {
  const day = utcDayNumber(date);
  return day >= utcDayNumber(period.periodStart) && day <= utcDayNumber(period.periodEnd);
}

/** `YYYY-MM-DD` for a UTC calendar day, the wire form of every statement date. */
export function toCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
