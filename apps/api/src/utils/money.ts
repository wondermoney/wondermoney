import { Big } from 'big.js';

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
 * Precision is therefore lost at *hydration*, before any code runs — which is why dotting
 * `big.js` around at call sites did not help: `new Big(0.30000000000000004)` faithfully
 * preserves the error it was handed.
 *
 * The fix has two halves. This module is the arithmetic half: every money operation goes
 * through exact decimal arithmetic and rounds once, at the end, to the target column's
 * scale. The storage half is the migration that constrains the previously-unbounded
 * `numeric` columns, so a value that *is* exact can no longer be widened back into noise.
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
export const MONEY_SCALE = 4;

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
 *
 * Every FX site in the codebase previously did a bare `amount * rate` with no rounding
 * step and no shared policy, in four duplicated places.
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

