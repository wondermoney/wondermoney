import { describe, expect, it } from 'vitest';

import {
  calculateLoanProgress,
  calculateNextPaymentDate,
  calculateOutstandingPrincipal,
  calculateOutstandingPrincipalWithAdjustments,
  calculateRemainingTermMonths,
  estimateRepaymentAllocation,
  validateRepaymentAllocation,
} from '../loan-calculation.service';

describe('calculateOutstandingPrincipal', () => {
  it('subtracts linked principal repayments from the opening balance', () => {
    expect(
      calculateOutstandingPrincipal({
        openingPrincipalBalance: 100_000,
        principalDecreases: [],
        principalIncreases: [],
        principalRepayments: [700, 725.5],
      }),
    ).toBe(98_574.5);
  });

  it('applies manual principal adjustments', () => {
    expect(
      calculateOutstandingPrincipal({
        openingPrincipalBalance: 10_000,
        principalDecreases: [500],
        principalIncreases: [250],
        principalRepayments: [1_000],
      }),
    ).toBe(8_750);
  });
});

describe('calculateOutstandingPrincipalWithAdjustments', () => {
  it('includes capitalized interest and write-offs', () => {
    expect(calculateOutstandingPrincipalWithAdjustments({
      adjustments: [
        { amount: 50, effectiveDate: new Date('2026-01-01'), type: 'CAPITALIZED_INTEREST' },
        { amount: 20, effectiveDate: new Date('2026-01-02'), type: 'WRITE_OFF' },
      ],
      openingPrincipalBalance: 1000,
      principalRepayments: [],
    })).toBe(1030);
  });

  it('applies balance corrections as the latest baseline', () => {
    expect(calculateOutstandingPrincipalWithAdjustments({
      adjustments: [
        { amount: 900, effectiveDate: new Date('2026-01-01'), type: 'BALANCE_CORRECTION' },
        { amount: 100, effectiveDate: new Date('2026-01-02'), type: 'PRINCIPAL_INCREASE' },
      ],
      openingPrincipalBalance: 1000,
      principalRepayments: [
        { amount: 50, effectiveDate: new Date('2026-01-03') },
      ],
    })).toBe(950);
  });

  it('subtracts repayments exactly, without float drift', () => {
    expect(calculateOutstandingPrincipalWithAdjustments({
      adjustments: [],
      openingPrincipalBalance: 171_400,
      principalRepayments: [
        { amount: 251.39, effectiveDate: new Date('2025-12-01') },
        { amount: 252.15, effectiveDate: new Date('2026-01-01') },
        { amount: 252.9, effectiveDate: new Date('2026-02-01') },
        { amount: 0.1, effectiveDate: new Date('2026-03-01') },
        { amount: 0.2, effectiveDate: new Date('2026-04-01') },
      ],
    })).toBe(170_643.26);
  });
});

describe('calculateLoanProgress', () => {
  it('uses original principal when available', () => {
    expect(
      calculateLoanProgress({
        openingPrincipalBalance: 150_000,
        originalPrincipal: 200_000,
        outstandingPrincipal: 125_000,
      }),
    ).toEqual({ progressBasis: 'ORIGINAL_PRINCIPAL', progressPercentage: 37.5 });
  });

  it('falls back to opening balance when original principal is missing', () => {
    expect(
      calculateLoanProgress({
        openingPrincipalBalance: 100_000,
        outstandingPrincipal: 80_000,
      }),
    ).toEqual({ progressBasis: 'OPENING_BALANCE', progressPercentage: 20 });
  });
});

describe('estimateRepaymentAllocation', () => {
  it('estimates interest and principal for a monthly fixed-rate loan', () => {
    expect(
      estimateRepaymentAllocation({
        annualInterestRateBps: 360,
        outstandingPrincipal: 100_000,
        totalPaymentAmount: 500,
      }),
    ).toEqual({
      feeAmount: 0,
      interestAmount: 300,
      needsReview: false,
      negativeAmortization: false,
      principalAmount: 200,
      totalPaymentAmount: 500,
    });
  });

  it('flags negative amortization when payment is below estimated interest', () => {
    expect(
      estimateRepaymentAllocation({
        annualInterestRateBps: 360,
        outstandingPrincipal: 100_000,
        totalPaymentAmount: 100,
      }),
    ).toEqual({
      feeAmount: 0,
      interestAmount: 100,
      needsReview: true,
      negativeAmortization: true,
      principalAmount: 0,
      totalPaymentAmount: 100,
    });
  });
});

describe('validateRepaymentAllocation', () => {
  it('accepts allocation sums within rounding tolerance', () => {
    expect(
      validateRepaymentAllocation({
        feeAmount: 0,
        interestAmount: 248.83,
        principalAmount: 238.4,
        totalPaymentAmount: 487.23,
      }),
    ).toEqual({ valid: true });
  });

  it('rejects mismatched allocation sums', () => {
    expect(
      validateRepaymentAllocation({
        feeAmount: 0,
        interestAmount: 200,
        principalAmount: 200,
        totalPaymentAmount: 487.23,
      }),
    ).toEqual({ reason: 'ALLOCATION_TOTAL_MISMATCH', valid: false });
  });
});

describe('calculateRemainingTermMonths', () => {
  it('handles zero-interest loans', () => {
    expect(
      calculateRemainingTermMonths({
        annualInterestRateBps: 0,
        outstandingPrincipal: 1_000,
        regularPaymentAmount: 250,
      }),
    ).toBe(4);
  });

  it('returns null for negative amortization', () => {
    expect(
      calculateRemainingTermMonths({
        annualInterestRateBps: 360,
        outstandingPrincipal: 100_000,
        regularPaymentAmount: 100,
      }),
    ).toBeNull();
  });

  it('runs past the contract when the stored payment is below the annuity payment', () => {
    // The seeded mortgage: EUR 168,382.33 at 3.6% needs about EUR 848.54 a month to clear in
    // the 302 months left to its maturity, so at EUR 742.18 it takes 381.03 payments. The
    // estimate is right for its inputs; it exceeds the 360-month original term because the
    // inputs disagree with the contract, which the client flags instead of capping.
    expect(
      calculateRemainingTermMonths({
        annualInterestRateBps: 360,
        outstandingPrincipal: 168_382.33,
        regularPaymentAmount: 742.18,
      }),
    ).toBe(382);
  });

  it('matches the contract when the payment is the annuity payment', () => {
    // EUR 185,000 at 3.6% over 360 months is EUR 841.0939 a month; the bank rounds the payment up to EUR 841.10.
    expect(
      calculateRemainingTermMonths({
        annualInterestRateBps: 360,
        outstandingPrincipal: 185_000,
        regularPaymentAmount: 841.1,
      }),
    ).toBe(360);
  });
});

describe('calculateNextPaymentDate', () => {
  it('uses the last day of the month when payment day does not exist', () => {
    expect(calculateNextPaymentDate(new Date('2026-02-10'), 31).toISOString()).toContain('2026-02-28');
  });

  it('rolls into the next month when the target day has already passed', () => {
    expect(calculateNextPaymentDate(new Date('2026-02-28'), 1).toISOString()).toContain('2026-03-01');
  });
});
