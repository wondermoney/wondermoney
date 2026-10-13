import Big from 'big.js';

import type { BudgetAllocationRow, BudgetSuppressionReason, SuppressedBudget } from './aggregation-types';

/**
 * Pure eligibility seam for Budget Allocation rows.
 *
 * The aggregation service used to validate allocation rows inside its own implementation, in
 * three places that subtly diverged (the weekly/monthly pressure filter was row-by-row rather
 * than whole-Budget). This module pulls the rule into one place so every aggregation method
 * consumes the same suppression set:
 *
 *   - A Budget with any row linked to a foreign tenant is omitted from every aggregation.
 *   - The suppression reason precedence is load-bearing; do not reorder.
 *   - The aggregation service still owns the result shape (`{ valid, suppressed }`).
 *
 * No `DI.em`, no module-level state. Everything here is a pure function over plain objects so
 * tests can drive the helper directly without spinning up a database.
 */

export interface PartitionedAllocations {
  /** Allocations that survived whole-Budget suppression, in their original query order. */
  rows: BudgetAllocationRow[];
  /** Budgets withheld from aggregation, in ascending `budgetKey` order. */
  suppressedBudgets: SuppressedBudget[];
}

/**
 * Group raw allocation rows by `budgetKey` first, then assign each Budget a single suppression
 * reason (or none). Caller-supplied row order is preserved within each Budget, and suppression
 * reasons appear in ascending `budgetKey` order.
 */
export function partitionByEligibility(
  rows: readonly BudgetAllocationRow[],
  scope: { appuserKey: number; tenantKey: number },
): PartitionedAllocations {
  const eligibleRows = rows.filter((row) => row.parentCategoryKey != null && new Big(row.amountBudgeted).gt(0));
  const budgets = new Map<number, BudgetAllocationRow[]>();
  for (const row of eligibleRows) {
    const budget = budgets.get(row.budgetKey) ?? [];
    budget.push(row);
    budgets.set(row.budgetKey, budget);
  }

  const validRows: BudgetAllocationRow[] = [];
  const suppressedBudgets: SuppressedBudget[] = [];
  for (const [budgetKey, budgetRows] of [...budgets.entries()].sort(([left], [right]) => left - right)) {
    const reason = suppressionReasonForBudget(budgetRows, scope.appuserKey, scope.tenantKey);
    if (reason) suppressedBudgets.push({ budgetKey, reason });
    else validRows.push(...budgetRows);
  }
  return { rows: validRows, suppressedBudgets };
}

/**
 * Suppression precedence is load-bearing and matches the historical caller validation:
 * no accounts at all, then any unusable account, then any account owned by another user,
 * then any account belonging to another tenant. A cross-tenant link therefore withholds
 * the Budget even when the owner happens to match.
 */
export function suppressionReasonForBudget(
  rows: readonly BudgetAllocationRow[],
  appuserKey: number,
  tenantKey: number,
): BudgetSuppressionReason | null {
  if (rows.every((row) => row.accountKey == null)) return 'budget_no_accounts';
  if (rows.some((row) => row.accountKey == null || row.accountClosed || row.accountDeleted)) return 'budget_account_unavailable';
  if (rows.some((row) => row.accountOwnerAppuserKey !== appuserKey)) return 'budget_account_owner_mismatch';
  if (rows.some((row) => row.accountTenantKey !== tenantKey)) return 'budget_account_tenant_mismatch';
  return null;
}

/**
 * Dedupes allocation rows by `budgetTemplateCategoryKey`, preserving first-occurrence order. The
 * raw allocation query may emit multiple rows per allocation (one per linked account), so callers
 * that want one-row-per-allocation consume this.
 */
export function uniqueAllocations(rows: readonly BudgetAllocationRow[]): BudgetAllocationRow[] {
  return [...new Map(rows.map((row) => [row.budgetTemplateCategoryKey, row])).values()];
}

/**
 * Account keys linked to one allocation, deduped and sorted ascending. Empty when no row for the
 * allocation carried an account link.
 */
export function accountKeysForAllocation(rows: readonly BudgetAllocationRow[], allocationKey: number): number[] {
  return [...new Set(
    rows.flatMap((row) => (row.budgetTemplateCategoryKey === allocationKey && row.accountKey != null ? [row.accountKey] : [])),
  )].sort((left, right) => left - right);
}
