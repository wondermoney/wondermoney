/**
 * Short, human dates — DESIGN_HISTORY.md rule 9.
 *
 * The reference prints `Mar 7`, never a zero-padded numeric date in a column
 * the eye is scanning. This app printed `02 Aug 2026`: three tokens, two of
 * which are identical on every row of a month-scoped table.
 *
 * Two decisions live here so they cannot drift between call sites:
 *
 * - **The year is dropped inside the current year** and kept outside it, so a
 *   short date never becomes an ambiguous one.
 * - **Day is `numeric`**, not `2-digit`. A leading zero buys nothing once the
 *   column is `tabular-nums`, and costs a character in the tightest column.
 *
 * Ordering is left to `Intl` — `2 ago` in pt, `Aug 2` in en-US, `2 Aug` in
 * en-GB — which is why this composes options rather than a template string.
 */

export interface ShortDateOptions {
  /** Keep the year even inside the current year. For archival or multi-year views. */
  alwaysShowYear?: boolean;
  /** Append the time, for surfaces where a row's ordering within a day matters. */
  withTime?: boolean;
}

export function formatShortDateForLocale(
  value: Date | string | number,
  locale: string,
  { alwaysShowYear = false, withTime = false }: ShortDateOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  // An invalid date is an absence, and § 9 rule 3 makes an absence an em-dash
  // rather than a plausible-looking wrong answer like "Invalid Date" or 1970.
  if (Number.isNaN(date.getTime())) return "—";

  const isCurrentYear = date.getFullYear() === new Date().getFullYear();

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(isCurrentYear && !alwaysShowYear ? {} : { year: "numeric" }),
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}
