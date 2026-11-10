import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/app';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { NotFoundError } from '@utils/errors';

import {
  type BudgetSuggestion,
  type BudgetSuggestionCategory,
  type BudgetSuggestionMonth,
  summarizeBudgetSuggestions,
} from './budget-suggestions';
import { getBudgetSpending } from './spending';

export interface BudgetSuggestionsResult {
  categories: BudgetSuggestion[];
  currencyCode: string;
  months: number;
  targetMonth: { month: number; year: number };
}

export interface SuggestBudgetAmountsInput {
  /** The budget's accounts; empty falls back to every account the viewer may see. */
  accountKeys: number[];
  budgetKey: number;
  months: 3 | 6 | 12;
  targetMonth: { month: number; year: number };
  tenantKey: number;
  viewerAppuserKey: number;
}

/**
 * Suggested monthly limits from the household's own spending. The window is the `months` complete
 * calendar months before `targetMonth`, so a partial current month never counts. Spending is the
 * budget's spending in the budget's currency: transfers, loan principal and goal funding are left
 * out, refunds net against their month, and a partner's private accounts stay hidden.
 */
export async function suggestBudgetAmounts(
  input: SuggestBudgetAmountsInput,
  em: EntityManager = DI.em,
): Promise<BudgetSuggestionsResult> {
  const budget = await em.findOne(
    Budget,
    { budgetKey: input.budgetKey, deletedAt: null },
    { populate: ['currencyKey'] },
  );
  if (!budget) throw new NotFoundError('Budget not found');

  const accountKeys = input.accountKeys.length > 0
    ? input.accountKeys
    : (await em.find(Account, {
        $or: [{ isPrivate: false }, { accountOwnerAppuserKey: { appuserKey: input.viewerAppuserKey } }],
        closed: false,
        deletedAt: undefined,
        tenantKey: { tenantKey: input.tenantKey },
      })).map((account) => account.accountKey);

  const categories = await budgetCategories(em, input.budgetKey, input.targetMonth);
  const currency = { code: budget.currencyKey.code, currencyKey: budget.currencyKey.currencyKey };
  const months: BudgetSuggestionMonth[] = [];

  for (let back = 1; back <= input.months; back += 1) {
    const period = priorMonth(input.targetMonth, back);
    const rows = await em.find(
      BudgetTemplateCategory,
      { budgetKey: { budgetKey: input.budgetKey }, month: period.month, year: period.year },
      { fields: ['budgetTemplateCategoryKey'] },
    );
    if (rows.length === 0) continue;
    const { categories: spending } = await getBudgetSpending({
      accountKeys,
      currency,
      period: 'monthly',
      templateKeys: rows.map((row) => row.budgetTemplateCategoryKey),
      tenantKey: input.tenantKey,
      viewerAppuserKey: input.viewerAppuserKey,
    });
    const byCategory = new Map<number, number>();
    for (const row of spending) {
      // Parent rows repeat their children's spending; a suggestion is per leaf category.
      if (row.child_category_name === null) continue;
      byCategory.set(row.category_key, row.category_amount);
    }
    months.push({ byCategory, month: `${period.year}-${String(period.month).padStart(2, '0')}` });
  }

  return {
    categories: summarizeBudgetSuggestions({ categories, months }),
    currencyCode: budget.currencyKey.code,
    months: input.months,
    targetMonth: input.targetMonth,
  };
}

/** The budget's leaf categories for the target month, in a stable order. */
async function budgetCategories(
  em: EntityManager,
  budgetKey: number,
  targetMonth: { month: number; year: number },
): Promise<BudgetSuggestionCategory[]> {
  const rows = await em.find(
    BudgetTemplateCategory,
    { budgetKey: { budgetKey }, month: targetMonth.month, year: targetMonth.year },
    { populate: ['categoryKey', 'categoryKey.parentCategory'] },
  );
  const seen = new Map<number, string>();
  for (const row of rows) {
    const category = row.categoryKey;
    // A parent category has no parent of its own; the budget plans leaf categories.
    if (category.parentCategory == null) continue;
    seen.set(category.categoryKey, category.name);
  }
  return [...seen].map(([categoryKey, categoryName]) => ({ categoryKey, categoryName }));
}

/** The month `back` complete months before `target`, crossing years. */
export function priorMonth(target: { month: number; year: number }, back: number): { month: number; year: number } {
  const index = target.year * 12 + (target.month - 1) - back;
  return { month: (index % 12) + 1, year: Math.floor(index / 12) };
}
