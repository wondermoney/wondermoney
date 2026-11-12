/**
 * Installment plans: a card purchase paid in N installments (issue #84).
 *
 * Future installments are projections only. A plan keeps its schedule as rows of its own;
 * nothing is a transaction until the bank (or the person) posts it, so the upcoming rows never
 * move a balance, a report or a budget. All amounts are positive magnitudes in the account's
 * currency, and dates are `YYYY-MM-DD` calendar days.
 */

/**
 * `paid`: linked to a posted transaction. `upcoming`: not linked and due today or later, a
 * projection. `unmatched`: not linked and its date has passed.
 */
export type InstallmentStatus = "paid" | "upcoming" | "unmatched";

export interface Installment {
  installmentNumber: number;
  amount: number;
  scheduledDate: string;
  /** Close day of the statement it belongs to; null when the account has no card cycle. */
  statementDate: string | null;
  dueDate: string | null;
  status: InstallmentStatus;
  transactionKey: number | null;
  postedAmount: number | null;
  postedDate: string | null;
}

export interface InstallmentPlan {
  installmentPlanKey: number;
  accountKey: number;
  accountName: string;
  currency: string;
  description: string;
  purchaseDate: string;
  totalAmount: number;
  installmentCount: number;
  categoryKey: number | null;
  paidCount: number;
  paidAmount: number;
  remainingCount: number;
  /** The plan's remaining commitment: the sum of its upcoming installments. */
  remainingAmount: number;
  unmatchedCount: number;
  nextInstallment: Installment | null;
}

export interface InstallmentPlanDetail extends InstallmentPlan {
  installments: Installment[];
}

export interface InstallmentCommitment {
  accountKey: number;
  accountName: string;
  currency: string;
  remainingAmount: number;
  remainingCount: number;
  activePlanCount: number;
  nextInstallment: {
    amount: number;
    date: string;
    installmentPlanKey: number;
    installmentNumber: number;
    installmentCount: number;
    description: string;
  } | null;
}

export interface InstallmentSuggestionTransaction {
  transactionKey: number;
  installmentNumber: number;
  amount: number;
  transactionDate: string;
  description: string;
}

/** A run of card rows that look like one purchase in installments. Never applied on its own. */
export interface InstallmentSuggestion {
  /** Stable per suggestion; for React keys only. */
  key: string;
  accountKey: number;
  accountName: string;
  currency: string;
  description: string;
  installmentCount: number;
  installmentAmount: number;
  totalAmount: number;
  purchaseDate: string;
  transactions: InstallmentSuggestionTransaction[];
}

/** What a transaction row carries when it is an installment of a plan. */
export interface TransactionInstallment {
  installmentPlanKey: number;
  installmentNumber: number;
  installmentCount: number;
}

export interface InstallmentLink {
  transactionKey: number;
  installmentNumber: number;
}

export interface CreateInstallmentPlanRequest {
  accountKey: number;
  description: string;
  purchaseDate: string;
  totalAmount: number;
  installmentCount: number;
  categoryKey?: number | null;
  links?: InstallmentLink[];
}

export type UpdateInstallmentPlanRequest = Partial<
  Pick<
    CreateInstallmentPlanRequest,
    | "description"
    | "purchaseDate"
    | "totalAmount"
    | "installmentCount"
    | "categoryKey"
  >
>;

export interface GetInstallmentPlansResponse {
  installmentPlans: InstallmentPlan[];
}

export interface GetInstallmentPlanResponse {
  installmentPlan: InstallmentPlanDetail;
}

export interface GetInstallmentCommitmentsResponse {
  commitments: InstallmentCommitment[];
}

export interface GetInstallmentSuggestionsResponse {
  suggestions: InstallmentSuggestion[];
}
