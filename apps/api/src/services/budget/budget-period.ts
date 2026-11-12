/**
 * The days a budget month covers. Every budget surface (the month and year views, rollover,
 * suggestions, the forecast, alerts and emails, reports and the assistant) reads them from here, so
 * a budget month is the same days everywhere.
 *
 * A budget has a `periodStartDay`, 1 to 28 (a day every month has). With 1, budget month
 * `year`-`month` is that calendar month. With a later day, it is named after the month it ends
 * in: with 25, month 2026-11 runs from 25 October to 24 November, and 25 November is in December.
 *
 * Days are UTC calendar days, as budget spending has always read a transaction's date: a bank
 * booking is stored at UTC midnight of its date (`transaction-date-range.ts`). A range is the
 * instants `[start, end)`: UTC midnight of its first day, inclusive, to UTC midnight of the day
 * after its last, exclusive.
 */

export const BUDGET_PERIOD_START_DAY_MIN = 1;
export const BUDGET_PERIOD_START_DAY_MAX = 28;

export interface BudgetMonth {
  month: number;
  year: number;
}

/** What a budget's months depend on: the `Budget` entity, or any row read from it. */
export interface BudgetPeriodSettings {
  periodStartDay: number;
}

/** `[start, end)`: UTC midnight of the first day, and of the day after the last. */
export interface BudgetPeriodRange {
  end: Date;
  start: Date;
}

/** Whether `value` can be a budget's start day: a whole day from 1 to 28. */
export function isBudgetPeriodStartDay(value: number): boolean {
  return Number.isInteger(value) && value >= BUDGET_PERIOD_START_DAY_MIN && value <= BUDGET_PERIOD_START_DAY_MAX;
}

/** The days budget month `year`-`month` covers. */
export function budgetPeriodRange(budget: BudgetPeriodSettings, year: number, month: number): BudgetPeriodRange {
  const startDay = checkedStartDay(budget.periodStartDay);
  // Date.UTC rolls month 0 and 13 into the next year, and every month has days 1 to 28.
  const endMonth = startDay === 1 ? month : month - 1;
  return { end: new Date(Date.UTC(year, endMonth, startDay)), start: new Date(Date.UTC(year, endMonth - 1, startDay)) };
}

/** The budget month whose range holds `date`: the month of its UTC day, or the next one from the start day on. */
export function budgetMonthOf(budget: BudgetPeriodSettings, date: Date): BudgetMonth {
  const startDay = checkedStartDay(budget.periodStartDay);
  const shift = startDay > 1 && date.getUTCDate() >= startDay ? 1 : 0;
  const index = date.getUTCFullYear() * 12 + date.getUTCMonth() + shift;
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

/** A range's first and last day as `YYYY-MM-DD`, as the API reports it. */
export function budgetPeriodDays(range: BudgetPeriodRange): { firstDay: string; lastDay: string } {
  return { firstDay: isoDay(range.start), lastDay: isoDay(new Date(range.end.getTime() - 86_400_000)) };
}

/**
 * {@link budgetPeriodRange} in SQL, for a budget month held in columns (`year` and `month` are SQL
 * expressions for integers, such as `"budget_template_category"."year"`): `start` and `end` are
 * timestamptz expressions for the same instants. The start day is checked and inlined.
 */
export function budgetPeriodRangeSql(year: string, month: string, periodStartDay: number): { end: string; start: string } {
  const startDay = checkedStartDay(periodStartDay);
  if (startDay === 1) {
    const first = `make_date(${year}, ${month}, 1)`;
    return { end: `((${first} + interval '1 month') at time zone 'UTC')`, start: `(${first}::timestamp at time zone 'UTC')` };
  }
  const startOfNext = `make_date(${year}, ${month}, ${String(startDay)})`;
  return { end: `(${startOfNext}::timestamp at time zone 'UTC')`, start: `((${startOfNext} - interval '1 month') at time zone 'UTC')` };
}

/** The month `offset` months after `month` (before, when negative), across years. */
export function shiftBudgetMonth(month: BudgetMonth, offset: number): BudgetMonth {
  const index = month.year * 12 + (month.month - 1) + offset;
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}

function checkedStartDay(value: number): number {
  if (!isBudgetPeriodStartDay(value)) throw new RangeError(`A budget month starts on a day from ${String(BUDGET_PERIOD_START_DAY_MIN)} to ${String(BUDGET_PERIOD_START_DAY_MAX)}, not ${String(value)}`);
  return value;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
