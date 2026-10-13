export type LoanType =
  | "MORTGAGE"
  | "AUTO_LOAN"
  | "PERSONAL_LOAN"
  | "STUDENT_LOAN"
  | "OTHER";

export type LoanStatus = "ACTIVE" | "PAID_OFF" | "CLOSED";

export interface LoanCurrencyDto {
  currencyKey: number;
  code: string;
}

export interface LoanListItem {
  loanKey: number;
  name: string;
  type: LoanType;
  status: LoanStatus;
  currency: LoanCurrencyDto;
  openingPrincipalBalance: number;
  originalPrincipal?: number | null;
  outstandingPrincipal: number;
  regularPaymentAmount?: number | null;
  annualInterestRateBps?: number | null;
  paymentDayOfMonth?: number | null;
  termMonths?: number | null;
  maturityDate?: string | null;
  providerName?: string | null;
  includeInNetWorth: boolean;
  notes?: string | null;
  progressBasis?: string;
  progressPercentage?: number;
  nextPaymentDate?: string | null;
}

export interface LoanDetail extends LoanListItem {
  openingBalanceDate?: string | null;
  paymentFrequency?: string;
  rateType?: string;
  remainingTermMonthsEstimated?: number | null;
  description?: string | null;
}

export interface LoanOverview {
  totalOutstandingDebt: number;
  monthlyRepaymentTotal: number;
  netWorthImpact: number;
  repaymentsNeedingReviewCount: number;
  interestFeesThisMonth: number;
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
  openingPrincipalBalance: number;
  openingBalanceDate: string;
  originalPrincipal?: number | null;
  annualInterestRateBps?: number | null;
  regularPaymentAmount?: number | null;
  paymentDayOfMonth?: number | null;
  termMonths?: number | null;
  maturityDate?: string | null;
  includeInNetWorth?: boolean;
  providerName?: string | null;
  notes?: string | null;
  status?: LoanStatus;
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
