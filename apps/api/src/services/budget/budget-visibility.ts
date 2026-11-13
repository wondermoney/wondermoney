import { type FindOptions, QueryOrder } from '@mikro-orm/core';

import type { Budget } from '@entity/Budget';

/**
 * Who sees a budget. A household budget is shared with every member of the household; a personal
 * one only with its owner (`Budget.ownerAppuserKey`), never with the other members, the household's
 * owner and admins included. Chosen when the budget is created.
 */
export const BUDGET_VISIBILITIES = ['household', 'personal'] as const;

export type BudgetVisibility = (typeof BUDGET_VISIBILITIES)[number];

export function budgetVisibilityOf(budget: Pick<Budget, 'ownerAppuserKey'>): BudgetVisibility {
  return budget.ownerAppuserKey == null ? 'household' : 'personal';
}

/**
 * Household budgets first, then personal ones, each oldest first: the order a reader that shows one
 * budget (the budget-vs-actual report, the assistant's budget status) picks by, so a member's
 * personal budget never displaces the household's.
 */
export const HOUSEHOLD_BUDGETS_FIRST: FindOptions<Budget>['orderBy'] = [{ ownerAppuserKey: QueryOrder.ASC_NULLS_FIRST }, { budgetKey: QueryOrder.ASC }];
