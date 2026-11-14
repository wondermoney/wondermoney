/**
 * Loan dates (opening balance, adjustments, rate changes) are calendar days, sent to the API
 * as `yyyy-mm-dd` and read back as UTC midnight. These helpers keep them as local calendar
 * days, so a date never shifts by one in a negative-offset time zone.
 */

/** A `yyyy-mm-dd` string (or the start of an ISO timestamp) as a local Date. */
export function parseDateInputValue(
  value: string | undefined,
): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** A local Date as the `yyyy-mm-dd` string the API expects. */
export function formatDateInputValue(date: Date | undefined): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
