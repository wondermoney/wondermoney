import { describe, expect, it } from 'vitest';

import { calculateEffectiveSpendingAmount } from '../loan-spending-adjustment.service';

describe('calculateEffectiveSpendingAmount', () => {
  it('returns interest plus fees for linked repayments', () => {
    expect(
      calculateEffectiveSpendingAmount({
        loanRepaymentLinks: [
          { feeAmount: 10, interestAmount: 290, principalAmount: 700 },
        ],
        transactionAmount: 1000,
      }),
    ).toBe(300);
  });

  it('returns the original amount for unlinked transactions', () => {
    expect(
      calculateEffectiveSpendingAmount({
        loanRepaymentLinks: [],
        transactionAmount: 1000,
      }),
    ).toBe(1000);
  });

  it('sums interest and fees across multiple links', () => {
    expect(
      calculateEffectiveSpendingAmount({
        loanRepaymentLinks: [
          { feeAmount: 5, interestAmount: 20, principalAmount: 75 },
          { feeAmount: 2, interestAmount: 8, principalAmount: 40 },
        ],
        transactionAmount: 150,
      }),
    ).toBe(35);
  });
});
