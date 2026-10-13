/**
 * Annual interest rate, converted between what a person types and what the API
 * stores.
 *
 * The API field is `annualInterestRateBps` and the read contract types it as
 * integer **basis points** (`z.number().int().min(0).max(10_000)`), which
 * `loans-view-model` divides by 100 to display a percentage. The write path
 * sent the percentage straight through, so a 3.1% mortgage was written as 3.1
 * basis points and read back as 0.03%.
 *
 * Both directions live here so they cannot drift apart again.
 */

/** Basis points per percentage point. */
const BPS_PER_PERCENT = 100

/** The maximum the read contract accepts: 10 000 bps = 100%. */
export const MAX_RATE_BPS = 10_000

/** What the user typed (a percentage) -> what the API stores (basis points). */
export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * BPS_PER_PERCENT)
}

/** What the API stores (basis points) -> what the user reads (a percentage). */
export function basisPointsToPercent(bps: number): number {
  return bps / BPS_PER_PERCENT
}
