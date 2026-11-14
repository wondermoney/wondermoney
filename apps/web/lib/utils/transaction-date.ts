/**
 * Transaction dates as the API stores them, read on the viewer's calendar.
 *
 * A bank booking carries a date and no time. The API stores it at **UTC midnight** of that date;
 * anything with a real time (a manual entry, a receipt) is stored at its instant. The API reads a
 * `transactionDate` at exactly UTC midnight as date-only and counts it on that calendar day for
 * every viewer (`transactionDateRangeParams` sends the viewer's time zone for that). This is the
 * same rule on the client, so a booking is shown on the day the filters count it on: formatting UTC
 * midnight in local time would put a 1 August booking on 31 July for anyone west of UTC.
 */

/** Whether a transaction date from the API is a date with no time (exactly UTC midnight). */
export function isDateOnlyTransactionDate(value: Date | string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * The `Date` to show a transaction date with, in local time: local midnight of its own date for a
 * date-only booking (so any local formatting, day, month or year check reads that date), its
 * instant otherwise. An invalid date for a value that is not one.
 */
export function transactionDisplayDate(value: Date | string): Date {
  const date = new Date(value);
  if (!isDateOnlyTransactionDate(date)) return date;
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The last instant a transaction date covers, in local time: the end of its own day for a
 * date-only booking, its instant otherwise. For "still to come" checks, so a payment expected on
 * a date stays upcoming all that day. An invalid date for a value that is not one.
 */
export function transactionDateEnd(value: Date | string): Date {
  const date = transactionDisplayDate(value);
  if (!isDateOnlyTransactionDate(value)) return date;
  date.setHours(23, 59, 59, 999);
  return date;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The local calendar day (`YYYY-MM-DD`) a transaction date falls on: its own date when it is date-only. */
export function localCalendarDay(value: Date | string): string {
  const date = transactionDisplayDate(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value.slice(0, 10) : "";
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
