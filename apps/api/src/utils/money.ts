import { Big } from 'big.js';

import { IS_PRODUCTION_LIKE } from '@config/env';
import logger from '@utils/logger';

/**
 * The single arithmetic surface for money in this application.
 *
 * ## Why this exists
 *
 * Every money column in the schema is Postgres `numeric` — exact decimal — but two layers
 * coerce it to an IEEE-754 double before application code ever sees it:
 *
 *   1. `database/di.ts` registers `setTypeParser(NUMERIC, parseFloat)` on the pg driver.
 *   2. MikroORM's `DecimalType.convertToJSValue` returns `+value` whenever the reflected
 *      runtime type is `number`, which it is on every money property.
 *
 * Precision is therefore lost at *hydration*, before any code runs — which is why using
 * `big.js` at individual call sites does not help: `new Big(0.30000000000000004)` faithfully
 * preserves the error it was handed.
 *
 * There are two halves. This module is the arithmetic half: every money operation goes
 * through exact decimal arithmetic and rounds once, at the end, to the target column's
 * scale. The storage half is the scale-constrained `numeric` columns, so a value that *is*
 * exact cannot be widened back into noise.
 *
 * ## Rounding mode
 *
 * `Big.RM` is set to ROUND_HALF_EVEN (banker's rounding) exactly once, here, at import.
 * This matters beyond taste: `big.js` defaults to ROUND_HALF_UP while `Math.round` rounds
 * toward positive infinity for negatives — `Math.round(-0.5) === -0` but
 * `new Big(-0.5).round(0)` is `-1`. Because expenses are stored as *negative* amounts,
 * the previous mix of helpers rounded income and expenses in different directions.
 * Half-even is the standard for financial aggregation and is direction-symmetric.
 */
Big.RM = Big.roundHalfEven;

/** Scale of the money columns (`numeric(18,4)`). Amounts and balances round to this. */
const MONEY_SCALE = 4;

/** Scale for values presented to a user (and for the 2dp budget/income columns). */
export const DISPLAY_SCALE = 2;

type Numeric = Big | null | number | string | undefined;

/** Coerce to Big, treating null/undefined/unparseable as zero. */
export function big(value: Numeric): Big {
  if (value === null || value === undefined || value === '') return new Big(0);
  if (value instanceof Big) return value;
  try {
    return new Big(value);
  } catch {
    return new Big(0);
  }
}

/**
 * Round to `scale` and return a JS number.
 *
 * The number return is deliberate: the entity properties are typed `number` and are
 * consumed that way by the web client through the `@api/*` path mapping, so returning
 * strings here would be a cross-repo breaking change. Rounding to the column's own scale
 * first means the double is exactly representable at that precision for every realistic
 * money magnitude, so the value survives the round-trip intact.
 */
export function toNumber(value: Numeric, scale: number = MONEY_SCALE): number {
  return Number(big(value).round(scale).toFixed(scale));
}

/** Exact sum, rounded once at the end rather than per-step. */
export function addMoney(a: Numeric, b: Numeric, scale: number = MONEY_SCALE): number {
  return toNumber(big(a).plus(big(b)), scale);
}



export function subtractMoney(a: Numeric, b: Numeric, scale: number = MONEY_SCALE): number {
  return toNumber(big(a).minus(big(b)), scale);
}

export function sumMoney(values: Numeric[], scale: number = MONEY_SCALE): number {
  return toNumber(values.reduce<Big>((total, value) => total.plus(big(value)), new Big(0)), scale);
}

/**
 * Convert `amount` between currencies at `rate`, rounding once to the target scale.
 * Every FX site goes through this rather than a bare `amount * rate`.
 */
export function convertMoney(amount: Numeric, rate: Numeric, scale: number = MONEY_SCALE): number {
  return toNumber(big(amount).times(big(rate)), scale);
}

/** Round a money value to the standard column scale. Replaces the six ad-hoc helpers. */
export function roundMoney(value: Numeric, scale: number = MONEY_SCALE): number {
  return toNumber(value, scale);
}

/** Round to 2dp for presentation. */
export function roundDisplay(value: Numeric): number {
  return toNumber(value, DISPLAY_SCALE);
}


/**
 * Exact equality at a given scale — use instead of `Math.abs(a - b) < epsilon` tolerances.
 * The balance-repair script's `<= 0.005` tolerance existed only to absorb float noise this
 * module removes.
 */
export function moneyEquals(a: Numeric, b: Numeric, scale: number = MONEY_SCALE): boolean {
  return big(a).round(scale).eq(big(b).round(scale));
}

/**
 * Arithmetic on amounts in two different currencies. Adding 10 USD to 10 EUR gives a number
 * that means nothing, so the `Money` operations refuse it instead.
 */
export class CurrencyMismatchError extends Error {
  constructor(readonly operation: string, readonly left: string, readonly right: string) {
    super(`Cannot ${operation} ${left} and ${right} amounts without converting one of them`);
    this.name = 'CurrencyMismatchError';
  }
}

/**
 * An amount together with its ISO currency code.
 *
 * The numeric helpers above stay for single-currency internals (a running balance, one row's
 * rounding). Anything that totals amounts that may belong to different household members, or to
 * accounts in different currencies, goes through `Money`: adding two currencies throws, and
 * crossing currencies takes an explicit rate.
 */
export interface Money {
  readonly amount: Big;
  readonly currency: string;
}

function assertSameCurrency(operation: string, left: Money, right: Money | string) {
  const rightCurrency = typeof right === 'string' ? right : right.currency;
  if (left.currency !== rightCurrency) throw new CurrencyMismatchError(operation, left.currency, rightCurrency);
}

export const Money = {
  add(left: Money, right: Money): Money {
    assertSameCurrency('add', left, right);
    return { amount: left.amount.plus(right.amount), currency: left.currency };
  },

  /** Convert at an explicit rate. Within one currency only a rate of 1 makes sense. */
  convert(value: Money, conversion: { rate: Numeric; to: string }): Money {
    const rate = big(conversion.rate);
    if (value.currency === conversion.to && !rate.eq(1)) {
      throw new RangeError(`A ${value.currency} amount cannot be converted to ${conversion.to} at ${rate.toString()}`);
    }
    return { amount: value.amount.times(rate), currency: conversion.to };
  },

  of(amount: Numeric, currency: string): Money {
    return { amount: big(amount), currency };
  },

  subtract(left: Money, right: Money): Money {
    assertSameCurrency('subtract', left, right);
    return { amount: left.amount.minus(right.amount), currency: left.currency };
  },

  /** Exact total in `currency`. Every value must already be in it. */
  sum(values: Money[], currency: string): Money {
    let total: Money = { amount: new Big(0), currency };
    for (const value of values) {
      assertSameCurrency('sum', total, value);
      total = { amount: total.amount.plus(value.amount), currency };
    }
    return total;
  },

  /** Round to `scale` and return a JS number, like {@link toNumber}. */
  toNumber(value: Money, scale: number = MONEY_SCALE): number {
    return toNumber(value.amount, scale);
  },
};

/**
 * Run a computation that may hit a {@link CurrencyMismatchError}.
 *
 * A mismatch is a bug in the caller: it summed before converting. Outside production it throws so
 * a test or a developer sees it. In production it is logged with where it happened, the operation
 * and both currency codes, and `fallback` supplies the result (an incomplete total) so one bad row
 * does not take down a page.
 */
export function guardCurrencyMismatch<T>(
  where: string,
  compute: () => T,
  fallback: () => T,
  options: { log?: (context: Record<string, string>) => void; rethrow?: boolean } = {},
): T {
  try {
    return compute();
  } catch (error) {
    const rethrow = options.rethrow ?? !IS_PRODUCTION_LIKE;
    if (!(error instanceof CurrencyMismatchError) || rethrow) throw error;
    const context = { left: error.left, operation: error.operation, right: error.right, where };
    if (options.log) options.log(context);
    else logger.error(context, 'Currency mismatch in money arithmetic; reporting the result as incomplete');
    return fallback();
  }
}

