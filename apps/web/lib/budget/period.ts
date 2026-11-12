/** The days a budget month covers, as the API sends them (`YYYY-MM-DD`, both inclusive). */
export interface BudgetPeriod {
  firstDay: string;
  lastDay: string;
}

/** The day of the month a budget month can start on: 1 (the calendar month) to 28. */
export const BUDGET_PERIOD_START_DAYS = Array.from(
  { length: 28 },
  (_, index) => index + 1,
);

/**
 * The days a budget month covers, for under its name ("Oct 25 – Nov 24"), or
 * null when the month is its calendar month (start day 1) and the name says it
 * all. The year shows only when the month spans two.
 */
export function budgetPeriodLabel(
  period: BudgetPeriod | undefined,
  periodStartDay: number | undefined,
  locale: string,
): string | null {
  if (!period || !periodStartDay || periodStartDay === 1) return null;
  const first = new Date(`${period.firstDay}T00:00:00Z`);
  const last = new Date(`${period.lastDay}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()))
    return null;
  const spansYears = first.getUTCFullYear() !== last.getUTCFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(spansYears ? { year: "numeric" } : {}),
    // The days are calendar days, not instants: read them in UTC so no zone moves them.
    timeZone: "UTC",
  }).formatRange(first, last);
}
