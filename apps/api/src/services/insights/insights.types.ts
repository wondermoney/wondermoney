import type { CategorizedTransaction } from '@service/budget/aggregation-classifier';
import type { BudgetAllocationRow } from '@service/budget/aggregation-types';

export type InsightSeverity = 'critical' | 'info' | 'warning';

export type InsightType = 'budget_pace' | 'spending_vs_normal';

/** A calendar month, `YYYY-MM`, in the household's Lisbon calendar. */
export type InsightPeriod = string;

/** A budget allocation on course to overrun, with the month-end projection. */
export interface BudgetPaceFacts {
  amountBudgeted: string;
  amountSpent: string;
  budgetKey: number;
  budgetName: string;
  budgetTemplateCategoryKey: number;
  categoryKey: number;
  categoryName: string;
  currencyCode: string;
  daysElapsed: number;
  daysInMonth: number;
  elapsedPercent: string;
  overBy: string;
  parentCategoryName: null | string;
  projectedAmount: string;
}

export interface BudgetPaceInput {
  allocations: readonly BudgetAllocationRow[];
  currentTransactions: readonly CategorizedTransaction[];
  daysElapsed: number;
  daysInMonth: number;
  month: number;
  year: number;
}

export type Insight =
  | {
      facts: BudgetPaceFacts;
      id: string;
      period: InsightPeriod;
      severity: InsightSeverity;
      type: 'budget_pace';
    }
  | {
      facts: SpendingVsNormalFacts;
      id: string;
      period: InsightPeriod;
      severity: InsightSeverity;
      type: 'spending_vs_normal';
    };

export interface SpendingBaselineMonth {
  month: number;
  transactions: readonly CategorizedTransaction[];
  year: number;
}

/** A top-level category spending faster (or slower) than its own three-month normal. */
export interface SpendingVsNormalFacts {
  baselineAmount: string;
  categoryKey: number;
  categoryKeys: number[];
  categoryName: string;
  currency: string;
  currentAmount: string;
  daysElapsed: number;
  deviationPercent: string;
  direction: 'above' | 'below';
  fromDate: string;
  toDate: string;
}

export interface SpendingVsNormalInput {
  baselineComplete: boolean;
  baselineMonths: readonly SpendingBaselineMonth[];
  currency: string;
  currentTransactions: readonly CategorizedTransaction[];
  daysElapsed: number;
  fromDate: string;
  month: number;
  toDate: string;
  year: number;
}
