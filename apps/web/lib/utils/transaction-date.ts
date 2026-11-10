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
