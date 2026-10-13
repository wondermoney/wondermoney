import type { InstantRange, LisbonBudgetPeriod, LisbonWeeklyPeriod } from './aggregation-periods';

export interface AggregationDiagnostics {
  ambiguousCategoryAssignments: number;
  duplicateTransactionRows: number;
  excludedTransfers: number;
  invalidAccounts: number;
  invalidLoanLinks: number;
  invalidTransactionDates: number;
  missingConvertedAmounts: number;
  uncategorizedTransactions: number;
}

export interface AggregationSuppressedResult {
  appuserKey: number;
  diagnostics: AggregationDiagnostics;
  facts: [];
  period: LisbonBudgetPeriod | LisbonWeeklyPeriod;
  reason: 'inactive_membership' | 'no_uniquely_categorized_transactions' | 'no_useful_sections';
  status: 'suppressed';
  tenantKey: number;
  weeklyComponents?: WeeklySignedComponents;
}

export interface BudgetAggregationResult {
  appuserKey: number;
  diagnostics: AggregationDiagnostics;
  facts: BudgetThresholdFact[];
  period: LisbonBudgetPeriod;
  status: 'ok';
  suppressedBudgets: SuppressedBudget[];
  tenantKey: number;
}

export interface BudgetAllocationRow {
  accountClosed: boolean | null;
  accountDeleted: boolean | null;
  accountKey: null | number;
  accountOwnerAppuserKey: null | number;
  accountTenantKey: null | number;
  amountBudgeted: string;
  budgetKey: number;
  budgetName: string;
  budgetTemplateCategoryKey: number;
  categoryKey: number;
  categoryName: string;
  categoryOwnerAppuserKey: null | number;
  categorySystem: boolean;
  currencyCode: string;
  parentCategoryKey: null | number;
  parentCategoryName: null | string;
  parentCategoryOwnerAppuserKey: null | number;
  parentCategorySystem: boolean | null;
}

export interface BudgetRemainingFacts {
  remaining: string;
  spent: string;
  totalBudgeted: string;
}

export interface BudgetRemainingResult {
  appuserKey: number;
  diagnostics: AggregationDiagnostics;
  facts: BudgetRemainingFacts;
  period: LisbonBudgetPeriod;
  status: 'ok';
  tenantKey: number;
}

export type BudgetSuppressionReason =
  | 'budget_account_owner_mismatch'
  | 'budget_account_tenant_mismatch'
  | 'budget_account_unavailable'
  | 'budget_no_accounts';

export interface BudgetThresholdFact {
  actualPercentage: string;
  amountBudgeted: string;
  amountSpent: string;
  budgetKey: number;
  budgetName: string;
  budgetTemplateCategoryKey: number;
  categoryKey: number;
  categoryName: string;
  claimThresholds: (80 | 100)[];
  currencyCode: string;
  month: number;
  parentCategoryName: null | string;
  remainingOrOverAmount: string;
  state: BudgetThresholdState;
  threshold: 80 | 100;
  year: number;
}

export type BudgetThresholdState = 'at_limit' | 'near' | 'over';

export interface MonthlyAggregationResult {
  appuserKey: number;
  diagnostics: AggregationDiagnostics;
  facts: MonthlyInsightFacts;
  period: LisbonBudgetPeriod;
  status: 'ok';
  tenantKey: number;
}

export interface MonthlyInsightFacts {
  monthTotal: string;
  topCategory: WeeklyTopCategory;
}

export interface MonthlyStoryAggregationResult {
  appuserKey: number;
  diagnostics: AggregationDiagnostics;
  facts: MonthlyStoryFacts;
  period: LisbonBudgetPeriod;
  status: 'ok';
  tenantKey: number;
}

export interface MonthlyStoryCategoryDelta {
  baselineAmount: string;
  categoryKey: number;
  direction: 'decrease' | 'increase';
  displayName: string;
  percentOfBaseline: null | string;
  subjectAmount: string;
}

export interface MonthlyStoryFacts {
  budgetPressure: 'near' | 'over' | 'within_plan' | null;
  categoryDeltas: MonthlyStoryCategoryDelta[];
  incomeBaseline: string;
  incomeSubject: string;
  recurringChanges: MonthlyStoryRecurringChange[];
  savingsRateBaseline: null | string;
  savingsRateSubject: null | string;
  spendingBaseline: string;
  spendingSubject: string;
}

export type MonthlyStoryInsufficientReason = 'insufficient_history' | 'zero_activity';

export interface MonthlyStoryInsufficientResult {
  appuserKey: number;
  monthsAvailable: number;
  monthsNeeded: 3;
  period: LisbonBudgetPeriod;
  reason: MonthlyStoryInsufficientReason;
  status: 'insufficient_data';
  tenantKey: number;
}

export interface MonthlyStoryRecurringChange {
  displayName: string;
  kind: 'changed' | 'new';
  newAmount: string;
  previousAmount: null | string;
  recurringSeriesKey: number;
}

export interface SuppressedBudget {
  budgetKey: number;
  reason: BudgetSuppressionReason;
}

export interface TenantAggregationInput {
  appuserKey: number;
  scheduledFor: string;
  tenantKey: number;
}

export interface TenantAggregationRepository {
  hasActiveMembership(appuserKey: number, tenantKey: number): Promise<boolean>;
  loadBudgetAllocations(appuserKey: number, month: number, year: number): Promise<BudgetAllocationRow[]>;
  loadTransactions(appuserKey: number, tenantKey: number, range: InstantRange): Promise<TransactionAggregationRow[]>;
}

export interface TransactionAggregationRow {
  accountClosed: boolean;
  accountDeleted: boolean;
  accountKey: number;
  accountOwnerAppuserKey: number;
  accountTenantKey: number;
  appuserKey: number;
  assignmentAppuserKey: null | number;
  assignmentDeleted: boolean | null;
  assignmentKey: null | number;
  categoryDeleted: boolean | null;
  categoryHasActiveChildren: boolean | null;
  categoryKey: null | number;
  categoryName: null | string;
  categoryOwnerAppuserKey: null | number;
  categorySystem: boolean | null;
  effectiveAmount: null | string;
  loanFeeAmount: null | string;
  loanInterestAmount: null | string;
  loanLinkDeleted: boolean | null;
  loanLinkedByAppuserKey: null | number;
  loanLinkKey: null | number;
  loanLinkTenantKey: null | number;
  parentCategoryDeleted: boolean | null;
  parentCategoryKey: null | number;
  parentCategoryName: null | string;
  parentCategoryOwnerAppuserKey: null | number;
  parentCategorySystem: boolean | null;
  tenantKey: number;
  transactionDate: Date | null;
  transactionKey: number;
  transactionType: null | string;
}

export interface WeeklyAggregationResult {
  appuserKey: number;
  diagnostics: AggregationDiagnostics;
  facts: WeeklyInsightFacts;
  period: LisbonWeeklyPeriod;
  status: 'ok';
  suppressedBudgets: SuppressedBudget[];
  tenantKey: number;
  weeklyComponents: WeeklySignedComponents;
}

export interface WeeklyInsightFacts {
  activeBudgetStatus: 'near' | 'over' | 'within_plan' | null;
  categoryTotals?: WeeklyTopCategory[];
  comparisonPercentage: null | string;
  comparisonWeekTotal: null | string;
  isoWeek: number;
  isoWeekYear: number;
  subjectWeekTotal: string;
  topCategory: WeeklyTopCategory;
}

export interface WeeklySignedComponents {
  activeBudgetStatus: 'near' | 'over' | 'within_plan' | null;
  categoryTotals: WeeklyTopCategory[];
  comparisonSignedTotal: null | string;
  hasSubjectTransactions: boolean;
  subjectSignedTotal: string;
}

export interface WeeklyTopCategory {
  amount: string;
  categoryKey: number;
  displayName: string;
}
