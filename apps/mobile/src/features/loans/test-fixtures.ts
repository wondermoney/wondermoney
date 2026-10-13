import type { LoanDto, LoanRepaymentCandidateDto, LoanRepaymentDto } from './loans-contract'

export const loanFixture: LoanDto = {
  annualInterestRateBps: 425,
  loanKey: 7,
  currency: { code: 'EUR', currencyKey: 1 },
  includeInNetWorth: true,
  maturityDate: '2030-06-30',
  name: 'Home loan',
  nextPaymentDate: '2026-08-05T00:00:00.000Z',
  notes: 'Fixed until 2028',
  openingBalanceDate: '2024-01-01',
  openingPrincipalBalance: 200_000,
  originalPrincipal: 220_000,
  outstandingPrincipal: 180_000,
  paymentDayOfMonth: 5,
  paymentFrequency: 'MONTHLY',
  progressBasis: 'ORIGINAL_PRINCIPAL',
  progressPercentage: 18.1818,
  providerName: 'Example lender',
  rateType: 'FIXED',
  regularPaymentAmount: 950,
  remainingTermMonthsEstimated: 240,
  status: 'ACTIVE',
  termMonths: 360,
  type: 'MORTGAGE',
}

export const repaymentFixture: LoanRepaymentDto = {
  allocationSource: 'MANUAL',
  loanRepaymentLinkKey: 21,
  feeAmount: 5,
  interestAmount: 300,
  needsReview: false,
  notes: null,
  paymentDate: '2026-06-05',
  principalAmount: 645,
  totalPaymentAmount: 950,
  transaction: {
    description: 'Monthly loan payment',
    merchantName: 'Example lender',
    settlementAmount: -950,
    transactionDate: '2026-06-05T10:00:00.000Z',
    transactionKey: 81,
  },
}

export const repaymentCandidateFixture: LoanRepaymentCandidateDto = {
  amount: 950,
  candidateScore: 0.91,
  confidence: 'HIGH',
  outstandingPrincipal: 180_000,
  reasons: ['AMOUNT_MATCH', 'MERCHANT_MATCH'],
  suggestedAllocation: { feeAmount: 5, interestAmount: 300, needsReview: false, negativeAmortization: false, principalAmount: 645, totalPaymentAmount: 950 },
  transaction: { description: 'Monthly loan payment', merchantName: 'Example lender', settlementAmount: -950, transactionDate: '2026-07-05T10:00:00.000Z', transactionKey: 82 },
}
