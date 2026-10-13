import Big from 'big.js';

import { floorMoney } from './aggregation-classifier';
import type { CategorizedTransaction, ClassifiedThreshold } from './aggregation-classifier';
import type { BudgetAllocationRow } from './aggregation-types';
import { accountKeysForAllocation } from './tenant-budget-eligibility';

/**
 * Severity of budget pressure shared by the weekly active-budget badge and the monthly Money
 * Story budget panel. `null` means "no allocations to judge"; `within_plan` means "allocations
 * exist but none reached the 80% near threshold".
 */
export type BudgetPressure = 'near' | 'over' | 'within_plan';

/**
 * Spend attributed to a single Budget allocation: the signed sum of the classified transactions
 * that share the allocation's category and one of the accounts linked to the allocation's
 * `budgetTemplateCategoryKey`, floored at zero so a net refund never produces a negative spend.
 *
 * `allAllocations` must carry every row for the allocation (one per linked account), not just the
 * row being measured — `accountKeysForAllocation` reads the account links from it.
 */
export function spendForAllocation(
  allocation: BudgetAllocationRow,
  transactions: readonly CategorizedTransaction[],
  allAllocations: readonly BudgetAllocationRow[],
): Big {
  const accountKeys = new Set(accountKeysForAllocation(allAllocations, allocation.budgetTemplateCategoryKey));
  return floorMoney(
    transactions
      .filter(
        (transaction) => transaction.categoryKey === allocation.categoryKey && accountKeys.has(transaction.accountKey),
      )
      .reduce((sum, transaction) => sum.plus(transaction.amount), new Big(0)),
  );
}

/**
 * Collapses the per-allocation `classifyBudgetThreshold` results into the one severity the callers
 * expose. `over` wins over `near`, and `at_limit` (spend exactly equals budget) counts as `over` —
 * matching the hand-rolled 100% check this replaces.
 *
 * Returns `null` only for an empty input, which is how `activeBudgetStatus` and
 * `monthlyBudgetPressure` signal "no allocations for the period". A non-empty input whose
 * thresholds are all `null` (every allocation below 80%) is `within_plan`.
 */
export function buildBudgetPressure(thresholds: readonly (ClassifiedThreshold | null)[]): BudgetPressure | null {
  if (thresholds.length === 0) return null;
  if (thresholds.some((threshold) => threshold?.state === 'over' || threshold?.state === 'at_limit')) return 'over';
  if (thresholds.some((threshold) => threshold?.state === 'near')) return 'near';
  return 'within_plan';
}
