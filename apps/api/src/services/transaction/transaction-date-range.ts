import { raw } from '@mikro-orm/core';
import { formatInTimeZone } from 'date-fns-tz';
import { type Expression, sql, type SqlBool } from 'kysely';

/**
 * Date-range filtering for transactions, shared by every endpoint that filters them by date: the
 * transaction list and its total, category spending, money in and out, cash flow and the reports.
 *
 * ## Two kinds of transaction date
 *
 * A bank booking carries a date and no time. Bank sync (`booking_date`, else `value_date`), statement
 * import and OCR store it at **UTC midnight** of that date. A manual entry and anything else with a
 * real time is stored at its exact instant. The column cannot tell them apart, so the rule is: a
 * `transaction_date` at exactly UTC midnight is a date-only row ({@link isDateOnlyTransactionDate}).
 * A real time of exactly 00:00:00.000 UTC is then read as a date, which for that row is the same day.
 *
 * ## The rule
 *
 * A client sends a range of whole days on the viewer's calendar as two instants (the first instant
 * of the first day and the last instant of the last day) plus the viewer's time zone. A row with a
 * real time is in the range when its instant is. A date-only row is in it when its date is one of
 * those calendar days. Comparing a date-only row's UTC midnight against the instants instead puts it
 * on the wrong day for anyone west of UTC: the first day's bookings fall before the range and the
 * day after's fall inside it.
 *
 * Without a time zone the viewer's days are unknown, so every row is compared as an instant, which
 * is what clients that send no time zone have always had.
 */

/** A range as a client sends it: instants, and the calendar the viewer picked the days in. */
export interface TransactionDateRange {
  /** First instant counted (inclusive). */
  from?: Date;
  /** IANA name of the viewer's time zone; without it the range is instants only. */
  timeZone?: string;
  /** Last instant counted (inclusive). */
  to?: Date;
}

interface Bound {
  /** The bound a date-only row is compared with: UTC midnight of the viewer's calendar day. */
  day: Date;
  /** The bound a row with a time is compared with. */
  instant: Date;
}

interface Bounds {
  lower?: Bound;
  upper?: Bound;
}

/** Whether a stored transaction date is a date with no time (UTC midnight). */
export function isDateOnlyTransactionDate(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

/**
 * The calendar day (`YYYY-MM-DD`) a transaction falls on for a viewer in `timeZone`: its own date
 * for a date-only row, the day of its instant in `timeZone` otherwise.
 */
export function transactionCalendarDay(date: Date, timeZone: string): string {
  return isDateOnlyTransactionDate(date) ? date.toISOString().slice(0, 10) : formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
}

function boundsOf(range: TransactionDateRange): Bounds {
  return {
    ...(range.from && { lower: { day: dayOf(range.from, range.timeZone), instant: range.from } }),
    ...(range.to && { upper: { day: dayOf(range.to, range.timeZone), instant: range.to } }),
  };
}

function dayOf(instant: Date, timeZone: string | undefined): Date {
  if (!timeZone) return instant;
  return new Date(`${formatInTimeZone(instant, timeZone, 'yyyy-MM-dd')}T00:00:00.000Z`);
}

/** A condition as SQL text and the values between its parts: `parts.length === values.length + 1`. */
interface SqlTemplate {
  parts: string[];
  values: Date[];
}

/**
 * The condition on `column` as a template. `column` is a `transaction_date` reference written by the
 * caller (e.g. `t.transaction_date`), never input. Each bound is an index-friendly instant
 * comparison widened to cover both kinds of row, then the exact rule per row.
 */
function rangeTemplate(column: string, range: TransactionDateRange): null | SqlTemplate {
  const { lower, upper } = boundsOf(range);
  if (!lower && !upper) return null;
  const tokens: (Date | string)[] = ['('];
  const bound = (operator: '<=' | '>=', value: Bound, widest: Date) => {
    if (tokens.length > 1) tokens.push(' and ');
    if (value.day.getTime() === value.instant.getTime()) {
      tokens.push(`${column} ${operator} `, value.instant);
      return;
    }
    tokens.push(
      `${column} ${operator} `, widest,
      ` and (case when ${column} = date_trunc('day', ${column}, 'UTC') then ${column} ${operator} `, value.day,
      ` else ${column} ${operator} `, value.instant, ' end)',
    );
  };
  if (lower) bound('>=', lower, lower.day < lower.instant ? lower.day : lower.instant);
  if (upper) bound('<=', upper, upper.day > upper.instant ? upper.day : upper.instant);
  tokens.push(')');
  const parts: string[] = [];
  const values: Date[] = [];
  let text = '';
  for (const token of tokens) {
    if (typeof token === 'string') {
      text += token;
      continue;
    }
    parts.push(text);
    values.push(token);
    text = '';
  }
  parts.push(text);
  return { parts, values };
}

/** The condition as SQL with `?` placeholders, for a hand-written query; `null` when the range has no bound. */
export function transactionDateRangeSql(column: string, range: TransactionDateRange): null | { params: Date[]; sql: string } {
  const template = rangeTemplate(column, range);
  return template && { params: template.values, sql: template.parts.join('?') };
}

/** The condition as a Kysely expression; `true` when the range has no bound. */
export function transactionDateRangeExpression(column: string, range: TransactionDateRange): Expression<SqlBool> {
  const template = rangeTemplate(column, range);
  if (!template) return sql<SqlBool>`true`;
  const [first = '', ...rest] = template.parts;
  return sql<SqlBool>`${sql.join([sql.raw(first), ...rest.flatMap((part, index) => [sql`${template.values[index]}`, sql.raw(part)])], sql.raw(''))}`;
}

/**
 * The condition as a MikroORM `where` entry on the `Transaction` root, to spread into a filter.
 * Empty when the range has no bound. A fresh raw fragment per call, as MikroORM requires.
 */
export function transactionDateRangeWhere(range: TransactionDateRange): Record<string, unknown> {
  const placeholder = '__transaction_date__';
  const condition = transactionDateRangeSql(placeholder, range);
  if (!condition) return {};
  return { [raw((alias: string) => condition.sql.replaceAll(placeholder, `${alias}.transaction_date`), condition.params)]: true };
}
