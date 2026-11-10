import { big, DISPLAY_SCALE, moneyEquals, roundDisplay, subtractMoney, sumMoney } from '@utils/money';
type ProgressBasis = 'OPENING_BALANCE' | 'ORIGINAL_PRINCIPAL';

export function calculateLoanProgress(input: {
  openingPrincipalBalance: number;
  originalPrincipal?: number;
  outstandingPrincipal: number;
}): { progressBasis: ProgressBasis; progressPercentage: number; } {
  const basis = input.originalPrincipal ?? input.openingPrincipalBalance;
  const progress = basis === 0 ? 0 : ((basis - input.outstandingPrincipal) / basis) * 100;

  return {
    progressBasis: input.originalPrincipal != null ? 'ORIGINAL_PRINCIPAL' : 'OPENING_BALANCE',
    progressPercentage: progress,
  };
}

export function calculateNextPaymentDate(referenceDate: Date, paymentDayOfMonth: number): Date {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const targetDay = Math.min(paymentDayOfMonth, lastDay);
  const sameMonthDate = new Date(Date.UTC(year, month, targetDay));

  if (sameMonthDate < referenceDate) {
    const nextMonthLastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
    const nextMonthDay = Math.min(paymentDayOfMonth, nextMonthLastDay);
    return new Date(Date.UTC(year, month + 1, nextMonthDay));
  }

  return sameMonthDate;
}

export function calculateOutstandingPrincipal(input: {
  openingPrincipalBalance: number;
  principalDecreases?: number[];
  principalIncreases?: number[];
  principalRepayments?: number[];
}): number {
  const repayments = input.principalRepayments?.reduce((sum, value) => sum + value, 0) ?? 0;
  const increases = input.principalIncreases?.reduce((sum, value) => sum + value, 0) ?? 0;
  const decreases = input.principalDecreases?.reduce((sum, value) => sum + value, 0) ?? 0;

  return input.openingPrincipalBalance - repayments + increases - decreases;
}

export function calculateOutstandingPrincipalWithAdjustments(input: {
  adjustments?: { amount: number; effectiveDate?: Date | null; type: 'BALANCE_CORRECTION' | 'CAPITALIZED_INTEREST' | 'FEE' | 'PRINCIPAL_DECREASE' | 'PRINCIPAL_INCREASE' | 'WRITE_OFF' }[];
  openingPrincipalBalance: number;
  principalRepayments?: { amount: number; effectiveDate?: Date | null }[];
}): number {
  const events = [
    ...(input.adjustments ?? []).map((adjustment) => ({ kind: 'adjustment' as const, ...adjustment })),
    ...(input.principalRepayments ?? []).map((repayment) => ({ kind: 'repayment' as const, ...repayment })),
  ].sort((a, b) => (a.effectiveDate?.getTime() ?? Number.POSITIVE_INFINITY) - (b.effectiveDate?.getTime() ?? Number.POSITIVE_INFINITY));

  // Accumulated exactly: a float running sum drifts (168382.32999999996 instead of
  // 168382.33), and that noise reached the DTO and every figure derived from it.
  let balance = big(input.openingPrincipalBalance);
  let correctionAppliedAt: null | number = null;

  for (const event of events) {
    const eventTime = event.effectiveDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (event.kind === 'adjustment') {
      switch (event.type) {
        case 'BALANCE_CORRECTION':
          balance = big(event.amount);
          correctionAppliedAt = eventTime;
          break;
        case 'CAPITALIZED_INTEREST':
        case 'FEE':
        case 'PRINCIPAL_INCREASE':
          if (correctionAppliedAt == null || eventTime >= correctionAppliedAt) balance = balance.plus(big(event.amount));
          break;
        case 'PRINCIPAL_DECREASE':
        case 'WRITE_OFF':
          if (correctionAppliedAt == null || eventTime >= correctionAppliedAt) balance = balance.minus(big(event.amount));
          break;
      }
    } else if (correctionAppliedAt == null || eventTime >= correctionAppliedAt) {
      balance = balance.minus(big(event.amount));
    }
  }

  return roundDisplay(balance);
}

/**
 * Months the balance takes to reach zero at the regular payment, from the annuity formula
 * n = -ln(1 - P·r / M) / ln(1 + r), rounded up (the last payment is a partial one).
 *
 * This is an estimate from the stored payment and rate, not the contract: when the stored
 * payment is below the annuity payment the contract implies (a stale payment after a rate
 * change, or a mistyped figure), the estimate honestly runs past the maturity date. Callers
 * compare it with the contract rather than this function capping it, because a capped
 * figure would hide that the payment no longer clears the loan on time.
 */
export function calculateRemainingTermMonths(input: {
  annualInterestRateBps: number;
  outstandingPrincipal: number;
  regularPaymentAmount: number;
}): null | number {
  const monthlyRate = input.annualInterestRateBps / 10000 / 12;
  const interestOnly = input.outstandingPrincipal * monthlyRate;
  if (input.regularPaymentAmount <= interestOnly) return null;
  if (monthlyRate === 0) return Math.ceil(input.outstandingPrincipal / input.regularPaymentAmount);

  const numerator = Math.log(input.regularPaymentAmount / (input.regularPaymentAmount - input.outstandingPrincipal * monthlyRate));
  const denominator = Math.log(1 + monthlyRate);
  return Math.ceil(numerator / denominator);
}

export function estimateRepaymentAllocation(input: {
  annualInterestRateBps: number;
  outstandingPrincipal: number;
  totalPaymentAmount: number;
}): {
  feeAmount: number;
  interestAmount: number;
  needsReview: boolean;
  negativeAmortization: boolean;
  principalAmount: number;
  totalPaymentAmount: number;
} {
  // Interest is money charged to a user and principal is the residual, so it absorbs every
  // upstream rounding error. Computed exactly and rounded once, at display scale (the loan
  // columns are 2dp).
  const interestAmount = roundDisplay(
    big(input.outstandingPrincipal).times(big(input.annualInterestRateBps).div(10_000)).div(12),
  );
  const principalAmount = subtractMoney(input.totalPaymentAmount, interestAmount, DISPLAY_SCALE);
  const negativeAmortization = principalAmount < 0;
  const cappedInterestAmount = negativeAmortization ? input.totalPaymentAmount : interestAmount;

  return {
    feeAmount: 0,
    interestAmount: cappedInterestAmount,
    needsReview: negativeAmortization,
    negativeAmortization,
    principalAmount: negativeAmortization ? 0 : principalAmount,
    totalPaymentAmount: input.totalPaymentAmount,
  };
}

export function validateRepaymentAllocation(input: {
  feeAmount: number;
  interestAmount: number;
  principalAmount: number;
  totalPaymentAmount: number;
}): { reason: 'ALLOCATION_TOTAL_MISMATCH'; valid: false; } | { valid: true } {
  // With exact arithmetic in the allocation above the parts sum to the whole exactly, so this
  // is a real equality check rather than a float-noise tolerance.
  const total = sumMoney([input.principalAmount, input.interestAmount, input.feeAmount], DISPLAY_SCALE);
  return moneyEquals(total, input.totalPaymentAmount, DISPLAY_SCALE)
    ? { valid: true }
    : { reason: 'ALLOCATION_TOTAL_MISMATCH', valid: false };
}
