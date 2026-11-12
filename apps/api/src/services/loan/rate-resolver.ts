export interface LoanRatePeriodInput {
  annualInterestRateBps: number;
  effectiveDate: Date;
}

/** Returns the last rate effective on or before date; before history begins, uses fallback. */
export function resolveLoanRate(
  periods: readonly LoanRatePeriodInput[],
  date: Date,
  fallbackRateBps: number,
): number {
  let result = fallbackRateBps;
  let effectiveTime = Number.NEGATIVE_INFINITY;
  for (const period of periods) {
    const candidateTime = period.effectiveDate.getTime();
    if (candidateTime <= date.getTime() && candidateTime >= effectiveTime) {
      result = period.annualInterestRateBps;
      effectiveTime = candidateTime;
    }
  }
  return result;
}
