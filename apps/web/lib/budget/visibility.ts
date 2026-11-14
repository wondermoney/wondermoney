/**
 * A household budget is shared with every member of the household; a personal
 * budget is seen only by the member who created it (not even by the
 * household's owner or admins). The API decides it at creation and never
 * changes it.
 */
export type BudgetVisibility = "household" | "personal";

export const BUDGET_VISIBILITIES = ["household", "personal"] as const;

type WithVisibility = { visibility?: BudgetVisibility };

/** A server from before personal budgets sends no visibility: every budget was the household's. */
export const budgetVisibilityOf = (budget: WithVisibility): BudgetVisibility =>
  budget.visibility ?? "household";

export const isPersonalBudget = (budget: WithVisibility) =>
  budgetVisibilityOf(budget) === "personal";

export interface BudgetVisibilityGroup<T> {
  visibility: BudgetVisibility;
  budgets: T[];
}

/**
 * The non-empty groups, household first, each keeping the order the budgets
 * came in. One group means the list needs no group headings.
 */
export function groupBudgetsByVisibility<T extends WithVisibility>(
  budgets: readonly T[],
): BudgetVisibilityGroup<T>[] {
  return BUDGET_VISIBILITIES.map((visibility) => ({
    visibility,
    budgets: budgets.filter(
      (budget) => budgetVisibilityOf(budget) === visibility,
    ),
  })).filter((group) => group.budgets.length > 0);
}

/**
 * The accounts a budget may link. A household budget is everyone's, so it
 * takes no private account (the API answers 400); a personal budget may take
 * any account the user sees, their own private ones included.
 */
export function linkableAccountsFor<T extends { isPrivate: boolean }>(
  accounts: readonly T[],
  visibility: BudgetVisibility,
): T[] {
  return visibility === "household"
    ? accounts.filter((account) => !account.isPrivate)
    : [...accounts];
}

/**
 * The linked accounts the picker still offers. A link it does not offer (a
 * private account on a household budget from before the rule) would make the
 * API refuse the whole save, so it is dropped when the user saves.
 */
export function linkedAccountKeysWithin(
  linkedAccountKeys: readonly number[],
  offered: readonly { accountKey: number }[],
): number[] {
  const offeredKeys = new Set(offered.map((account) => account.accountKey));
  return linkedAccountKeys.filter((key) => offeredKeys.has(key));
}
