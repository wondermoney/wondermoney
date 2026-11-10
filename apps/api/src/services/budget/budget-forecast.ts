import type Big from 'big.js';

import { RecurringCadence } from '@service/recurring/recurring-types';
import { big, toNumber } from '@utils/money';

/** One budget category in one month of the forecast window. */
export interface ForecastRowInput {
  /** The row's monthly plan (its amount spread by its recurrency, as the budget month shows it). */
  budgeted: number;
  /** Current month only: what rollover carries in, as the budget month shows it. */
  carriedIn?: number;
  /** Current month only: false when that carry rests on spending that could not be converted. */
  carriedInComplete?: boolean;
  categoryKey: number;
  /** What recurring items are expected to take from the category, from today to the month's end. */
  projected: number;
  /** False when a recurring item had no rate into the budget's currency and is left out of `projected`. */
  projectedComplete: boolean;
  rolloverEnabled: boolean;
  /** Current month only: what the category has spent so far, as the budget month shows it. */
  spent?: number;
  /** Current month only: false when some of that spending could not be converted. */
  spentComplete?: boolean;
}

/**
 * One month of the window. The first is the current month (its rows carry `spent` and
 * `carriedIn`); every later one is in the future, consecutive with the one before.
 */
export interface ForecastMonth {
  /** `budgeted + carriedIn`: what the month may spend. */
  available: number;
  budgeted: number;
  /**
   * What rollover carries in. In the current month the carry the budget month shows; later, a
   * projection: what the month before is expected to overspend (when the budget carries overspend).
   */
  carriedIn: number;
  /** False when some spending, carry or recurring item behind the month could not be converted. */
  complete: boolean;
  /**
   * What the month is expected to spend: per category, its available amount, or more where spending
   * so far plus the upcoming recurring items exceed it. Never below zero.
   */
  expectedSpend: number;
  income: number;
  /** `current` has actual spending so far; `future` is projected only. */
  kind: 'current' | 'future';
  month: number;
  /** `income - expectedSpend`. */
  net: number;
  /** What recurring items are expected to take in the rest of the month. A projection, never actual. */
  projectedSpend: number;
  /** Actual spending so far in the current month; null for a future month, which has none. */
  spent: null | number;
  year: number;
}

export interface ForecastMonthInput {
  /** The budget's planned income for the month. */
  income: number;
  month: number;
  rows: ForecastRowInput[];
  year: number;
}

interface CategoryState {
  available: Big;
  expected: Big;
  incomplete: boolean;
  rolloverEnabled: boolean;
}

/**
 * The forecast of a budget over a window of months starting at the current one.
 *
 * Per category, a month may spend `available = budgeted + carry` and is expected to spend
 * `max(available, spent + projected, 0)`: its plan, unless what it has spent plus what recurring
 * items will take is already more. A carry into a future month follows the rollover rule
 * (`budget-rollover.ts`: both months have rollover on) applied to that expectation:
 *
 *   carry(n) = available(n-1) - expected(n-1)
 *
 * which is never positive (a month is expected to use its whole plan), so only a projected
 * overspend carries, and only when the budget carries overspend. Net is the month's planned income
 * less its expected spending.
 */
export function computeForecast(months: readonly ForecastMonthInput[], options: { carryOverspend: boolean }): ForecastMonth[] {
  let previous = new Map<number, CategoryState>();
  return months.map((input, index) => {
    const isCurrent = index === 0;
    const states = new Map<number, CategoryState>();
    let budgeted = big(0);
    let carriedIn = big(0);
    let available = big(0);
    let expected = big(0);
    let projected = big(0);
    let spent = big(0);
    let complete = true;

    for (const row of input.rows) {
      let carry = big(0);
      let incomplete = !row.projectedComplete;
      if (isCurrent) {
        if (row.rolloverEnabled) carry = big(row.carriedIn);
        incomplete ||= row.spentComplete === false || (row.rolloverEnabled && row.carriedInComplete === false);
      } else {
        const before = previous.get(row.categoryKey);
        if (row.rolloverEnabled && before?.rolloverEnabled) {
          carry = before.available.minus(before.expected);
          if (!options.carryOverspend && carry.lt(0)) carry = big(0);
          incomplete ||= before.incomplete;
        }
      }
      const rowAvailable = big(row.budgeted).plus(carry);
      const committed = big(isCurrent ? row.spent : 0).plus(row.projected);
      const rowExpected = maxOf(rowAvailable, committed, big(0));
      states.set(row.categoryKey, { available: rowAvailable, expected: rowExpected, incomplete, rolloverEnabled: row.rolloverEnabled });

      budgeted = budgeted.plus(row.budgeted);
      carriedIn = carriedIn.plus(carry);
      available = available.plus(rowAvailable);
      expected = expected.plus(rowExpected);
      projected = projected.plus(row.projected);
      if (isCurrent) spent = spent.plus(big(row.spent));
      if (incomplete) complete = false;
    }

    previous = states;
    return {
      available: toNumber(available),
      budgeted: toNumber(budgeted),
      carriedIn: toNumber(carriedIn),
      complete,
      expectedSpend: toNumber(expected),
      income: toNumber(input.income),
      kind: isCurrent ? 'current' : 'future',
      month: input.month,
      net: toNumber(big(input.income).minus(expected)),
      projectedSpend: toNumber(projected),
      spent: isCurrent ? toNumber(spent) : null,
      year: input.year,
    };
  });
}

function maxOf(...values: Big[]): Big {
  return values.reduce((largest, value) => (value.gt(largest) ? value : largest));
}

/** What projecting a recurring item needs to know about it. */
export interface ProjectableSeries {
  cadence: RecurringCadence;
  /** The last time it was seen: a date on or before it has already happened. */
  lastSeenAt?: Date | null;
  nextExpectedAt?: Date | null;
}

/**
 * The dates a recurring item is expected on inside `window` (UTC days, both ends included),
 * stepping from its next expected date by its cadence. A monthly, quarterly or yearly step keeps
 * the day of the month, or the month's last day when it is shorter. Dates before `window.from`
 * (an overdue item) and on or before the day it was last seen are skipped: those either happened,
 * and are in the actual spending, or were missed.
 */
export function projectOccurrences(series: ProjectableSeries, window: { from: Date; to: Date }): Date[] {
  if (!series.nextExpectedAt) return [];
  const anchor = utcDay(series.nextExpectedAt);
  const from = Math.max(utcDay(window.from).getTime(), series.lastSeenAt ? utcDay(series.lastSeenAt).getTime() + DAY_MS : Number.NEGATIVE_INFINITY);
  const to = utcDay(window.to).getTime();
  const dates: Date[] = [];
  for (let step = 0; ; step += 1) {
    const date = stepFrom(anchor, series.cadence, step);
    if (date.getTime() > to) break;
    if (date.getTime() >= from) dates.push(date);
  }
  return dates;
}

const DAY_MS = 86_400_000;

function addUtcMonths(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay)));
}

function stepFrom(anchor: Date, cadence: RecurringCadence, step: number): Date {
  switch (cadence) {
    case RecurringCadence.biweekly:
      return new Date(anchor.getTime() + step * 14 * DAY_MS);
    case RecurringCadence.monthly:
      return addUtcMonths(anchor, step);
    case RecurringCadence.quarterly:
      return addUtcMonths(anchor, step * 3);
    case RecurringCadence.weekly:
      return new Date(anchor.getTime() + step * 7 * DAY_MS);
    case RecurringCadence.yearly:
      return addUtcMonths(anchor, step * 12);
  }
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
