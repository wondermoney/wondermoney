export type GoalStatus = "active" | "archived" | "completed" | "paused";

export type GoalSummaryStatus = "behind" | "funded" | "on_track" | "paused";

export type GoalType = "debt_paydown" | "save_up";

export interface DebtProjection {
  currentBalance: number;
  monthlyPayment: number;
  months: null | number;
  originalBalance: number;
  paidOffAmount: number;
  payoffDate: null | string;
  paysOff: boolean;
  progressPercentage: number;
  totalInterest: number;
}

export interface StrategyDebtResult {
  id: number;
  months: null | number;
  totalInterest: number;
}

export interface StrategyResult {
  months: number;
  order: number[];
  perDebt: StrategyDebtResult[];
  totalInterest: number;
}

export interface DebtStrategyDebt {
  annualInterestRateBps: number;
  balance: number;
  id: number;
  minimumPayment: number;
  name: string;
}

export interface DebtStrategyResponse {
  avalanche: null | StrategyResult;
  debts: DebtStrategyDebt[];
  extraBudget: number;
  snowball: null | StrategyResult;
}

export type GoalActivityType =
  | "archived"
  | "assigned"
  | "completed"
  | "goal_created"
  | "goal_updated"
  | "manual_adjustment"
  | "moved_in"
  | "moved_out"
  | "paused"
  | "resumed"
  | "spent_from_goal"
  | "transaction_funding_reversed";

export type GoalKey = number;

export interface CurrencyRef {
  code?: string;
  currencyKey?: number;
}

export interface EntityRef {
  [key: string]: unknown;
}

export interface Goal {
  annualInterestRateBps?: null | number;
  archivedAt?: string | null;
  accountLinks?: {
    accountKey: { accountKey: number; accountName?: string | null } | number;
    goalAccountLinkKey: number;
  }[];
  completedAt?: string | null;
  createdAt?: string;
  loanKey?: null | number;
  currencyKey?: CurrencyRef | number;
  currencyCode?: string;
  currentBalance?: null | number;
  description?: null | string;
  extraPayment?: null | number;
  goalKey: GoalKey;
  icon?: null | string;
  minimumPayment?: null | number;
  monthlyContributionTarget?: null | number;
  name: string;
  priority?: number;
  status: GoalStatus;
  summary?: GoalSummary;
  targetAmount: number;
  targetDate?: Date | null | string;
  type?: GoalType;
  updatedAt?: string;
}

export interface GoalSummary {
  assignedThisMonth: number;
  availableAmount: number;
  debtProjection?: DebtProjection;
  fundedHistorically: number;
  monthlyShortfall: null | number;
  progressPercentage: number;
  remainingToTarget: number;
  requiredMonthlyContribution: null | number;
  spentAmount: number;
  status: GoalSummaryStatus;
}

export interface GoalActivity {
  amount?: null | number;
  categoryKey?: EntityRef | null | number;
  currencyKey?: CurrencyRef | null | number;
  destinationKey?: null | number;
  destinationType?: null | string;
  goalActivityKey: number;
  goalKey: Goal | GoalKey;
  note?: null | string;
  occurredAt: Date | string;
  sourceKey?: null | number;
  sourceType?: null | string;
  transactionKey?: EntityRef | null | number;
  type: GoalActivityType;
}

export interface GoalTransactionFunding {
  amount: number;
  currencyKey?: CurrencyRef | number;
  goalKey?: Goal | GoalKey;
  goalTransactionFundingKey: number;
  reversedAt?: null | string;
  transactionKey?: EntityRef | number;
}

export interface GoalAccountLink {
  accountKey: EntityRef | number;
  goalAccountLinkKey: number;
  goalKey: Goal | GoalKey;
}

export interface GetGoalsParams {
  includeArchived?: boolean;
}

export interface GetGoalsResponse {
  goals: Goal[];
}

export interface GetGoalResponse {
  goal: Goal;
  summary: GoalSummary;
}

export interface GetGoalActivityResponse {
  activities: GoalActivity[];
  limit: number;
  offset: number;
  total: number;
}

export interface CreateGoalRequest {
  annualInterestRatePercent?: number;
  loanKey?: null | number;
  currencyId?: number;
  currentBalance?: number;
  description?: null | string;
  extraPayment?: number;
  minimumPayment?: number;
  monthlyContributionTarget?: null | number;
  name: string;
  priority?: number;
  targetAmount?: number;
  targetDate?: Date | null | string;
  type?: GoalType;
}

export interface UpdateGoalRequest {
  annualInterestRatePercent?: number;
  loanKey?: null | number;
  currencyId?: number;
  currentBalance?: number;
  description?: null | string;
  extraPayment?: number;
  minimumPayment?: number;
  monthlyContributionTarget?: null | number;
  name?: string;
  priority?: number;
  targetAmount?: number;
  targetDate?: Date | null | string;
  type?: GoalType;
}

export interface CreateGoalResponse {
  goal: Goal;
}

export interface UpdateGoalResponse {
  goal: Goal;
}

export interface AssignGoalMoneyRequest {
  amount: number;
}

export interface MoveGoalMoneyOutRequest {
  amount: number;
}

export interface FundGoalTransactionRequest {
  amount: number;
  transactionKey: number;
}

export interface FundGoalTransactionResponse {
  funding: GoalTransactionFunding;
}

export interface DeleteGoalFundTransactionRequest {
  fundingKey: number;
}

export interface GoalAccountRequest {
  accountKey: number;
}

export interface GoalAccountResponse {
  link: GoalAccountLink;
}

export interface GoalActivityParams {
  limit?: number;
  offset?: number;
}

export interface GetAvailableToAssignResponse {
  availableToAssign: number;
}
