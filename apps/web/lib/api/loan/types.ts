export type LoanType =
  "MORTGAGE" | "AUTO_LOAN" | "PERSONAL_LOAN" | "STUDENT_LOAN" | "OTHER";

export type LoanStatus = "ACTIVE" | "PAID_OFF" | "CLOSED";

export type LoanAmortizationMethod = "FRENCH" | "CONSTANT_PRINCIPAL";
export type LoanRateType = "FIXED" | "VARIABLE" | "UNKNOWN";
export type LoanAdjustmentType =
  | "BALANCE_CORRECTION"
  | "FEE"
  | "CAPITALIZED_INTEREST"
  | "PRINCIPAL_INCREASE"
  | "PRINCIPAL_DECREASE"
  | "WRITE_OFF";

/** A lender correction or another change to the balance, from `/v1/loan/:id/adjustments`. */
export interface LoanAdjustment {
  loanAdjustmentKey: number;
  type: LoanAdjustmentType;
  /** A calendar day, as UTC midnight. */
  effectiveDate: string;
  /** The balance a correction sets; for every other type, the change (always positive). */
  amount: number;
  reason: string | null;
}

export interface LoanAdjustmentRequest {
  type: LoanAdjustmentType;
  effectiveDate: string;
  amount: number;
  reason?: string | null;
}

/** A rate that applies from its effective date until the next one. */
export interface LoanRatePeriod {
  loanRatePeriodKey: number;
  /** A calendar day, as UTC midnight. */
  effectiveDate: string;
  annualInterestRateBps: number;
}

export interface LoanRatePeriodRequest {
  effectiveDate: string;
  annualInterestRateBps: number;
}

export interface LoanCurrencyDto {
  currencyKey: number;
  code: string;
}

/** The asset a loan is secured against, as the loan endpoints return it. */
export interface LoanSecuredAsset {
  /** The asset's `manualAssetKey`. */
  key: number;
  name: string;
  /** The asset's currency, which `value` is in. */
  currency: string;
  /** Today's value. Null for an archived asset. */
  value: number | null;
}

export interface LoanListItem {
  loanKey: number;
  name: string;
  type: LoanType;
  status: LoanStatus;
  amortizationMethod?: LoanAmortizationMethod | null;
  currency: LoanCurrencyDto;
  openingPrincipalBalance: number;
  originalPrincipal?: number | null;
  outstandingPrincipal: number;
  regularPaymentAmount?: number | null;
  /** The rate in force today: the latest rate change, else the loan's own rate. */
  annualInterestRateBps?: number | null;
  /**
   * The loan's own rate, which applies until its first rate change. This, not today's rate,
   * is what `annualInterestRateBps` in an update request sets.
   */
  initialAnnualInterestRateBps?: number | null;
  paymentDayOfMonth?: number | null;
  termMonths?: number | null;
  maturityDate?: string | null;
  providerName?: string | null;
  includeInNetWorth: boolean;
  notes?: string | null;
  progressBasis?: string;
  progressPercentage?: number;
  nextPaymentDate?: string | null;
  /** The asset the loan is secured against, if any. */
  securedAsset: LoanSecuredAsset | null;
}

export interface LoanDetail extends LoanListItem {
  openingBalanceDate?: string | null;
  firstPaymentDate?: string | null;
  paymentFrequency?: string;
  rateType?: LoanRateType;
  remainingTermMonthsEstimated?: number | null;
  description?: string | null;
}

export interface LoanScheduleRow {
  number: number;
  date: string;
  payment: number;
  interest: number;
  principal: number;
  endingBalance: number;
  paid: boolean;
}

export interface LoanSchedule {
  rows: LoanScheduleRow[];
  totalInterest: number;
  totalPaid: number;
}

export type LoanProjectionFrequency = "monthly" | "one-off";

export interface LoanProjectionPoint {
  month: number;
  date: string;
  baselineBalance: number;
  withExtraBalance: number;
}

export interface LoanProjection {
  paysOff: boolean;
  reason: "PAYMENT_BELOW_INTEREST" | null;
  payoffDate: string | null;
  months: number | null;
  totalInterest: number;
  interestSaved: number;
  monthsSaved: number;
  aheadOrBehindMonths: number | null;
  contractInterest: number;
  contractMonths: number;
  series: LoanProjectionPoint[];
}

export interface LoanProjectionFilters {
  extra?: number;
  frequency?: LoanProjectionFrequency;
  startDate?: string;
}

export interface LoanOverview {
  totalOutstandingDebt: number;
  monthlyRepaymentTotal: number;
  netWorthImpact: number;
  repaymentsNeedingReviewCount: number;
  interestFeesThisMonth: number;
  /** The user's currency, which every total above is in. */
  currency?: string;
  /** Loans in another currency with no exchange rate, left out of the totals. */
  unconvertedLoanCount?: number;
  totalOutstandingAmount?: number;
  totalInterestAmount?: number;
  overdueLoansCount?: number;
}

export interface LoanRepayment {
  loanRepaymentLinkKey: number;
  loanKey: number;
  transactionKey?: number;
  accountName?: string | null;
  accountNumber?: string | null;
  amount?: number;
  feeAmount: number;
  interestAmount: number;
  notes?: string | null;
  paidAt?: string;
  principalAmount: number;
  totalPaymentAmount: number;
  paymentDate: string;
  needsReview?: boolean;
  /** The bank transaction the repayment is linked to, as the API sends it. */
  transaction?: {
    transactionKey: number;
    description?: string | null;
    settlementAmount?: number;
    transactionDate?: string;
  } | null;
}

export interface LoanRepaymentCandidate {
  transactionKey: number;
  amount: number;
  candidateScore: number;
  confidence: number;
  currencyCode: string;
  description?: string | null;
  accountName?: string | null;
  bookingDate?: string | null;
  outstandingPrincipal: number;
  reasons: string[];
  merchantName?: string | null;
  valueDate?: string | null;
}

export interface LoanRepaymentCandidatesFilters {
  accountKey?: number;
  amount?: number;
  endDate?: string;
  search?: string;
  startDate?: string;
}

export interface CreateLoanRequest {
  name: string;
  type: LoanType;
  currencyKey: number;
  amortizationMethod?: LoanAmortizationMethod;
  firstPaymentDate?: string | null;
  openingPrincipalBalance: number;
  openingBalanceDate: string;
  originalPrincipal?: number | null;
  annualInterestRateBps?: number | null;
  rateType?: LoanRateType;
  regularPaymentAmount?: number | null;
  paymentDayOfMonth?: number | null;
  termMonths?: number | null;
  maturityDate?: string | null;
  includeInNetWorth?: boolean;
  providerName?: string | null;
  notes?: string | null;
  status?: LoanStatus;
  /**
   * The manual asset the loan is secured against. On an update `null` unlinks it and
   * leaving it out keeps the current one.
   */
  securedAssetKey?: number | null;
}

export type UpdateLoanRequest = Partial<CreateLoanRequest>;

export interface LinkLoanRepaymentRequest {
  transactionKey: number;
  principalAmount: number;
  feeAmount: number;
  interestAmount: number;
  totalPaymentAmount: number;
}

export interface UpdateLoanRepaymentRequest extends Partial<LinkLoanRepaymentRequest> {}
