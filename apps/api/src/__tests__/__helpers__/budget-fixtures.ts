/**
 * Budget rows for tests that run against `pg-test-db.ts`: a budget and one row per category
 * per month, the shape `createBudget` and `addBudgetCategory` store.
 */
import type { EntityManager } from '@mikro-orm/postgresql';

import type { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import type { Recurrency } from '@utils/budget';

import { addCategory, type Household } from './finance-fixtures';

export interface BudgetLine {
  accounts?: Account[];
  amount: number;
  category?: Category;
  /** Months of `year` to store; defaults to all twelve. */
  months?: number[];
  name?: string;
  recurrency?: Recurrency;
  rolloverEnabled?: boolean;
  year: number;
}

export async function addBudget(em: EntityManager, household: Household, input: { deleted?: boolean; lines: BudgetLine[]; name?: string; periodStartDay?: number; rolloverCarriesOverspend?: boolean }) {
  const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, deletedAt: input.deleted ? new Date() : undefined, name: input.name ?? 'Home', numAdults: 1, numDependents: 0, periodStartDay: input.periodStartDay ?? 1, rolloverCarriesOverspend: input.rolloverCarriesOverspend ?? true, tenantKey: household.tenant }, { partial: true });
  await em.flush();
  const categories: Category[] = [];
  for (const [index, line] of input.lines.entries()) {
    const category = line.category ?? (await addCategory(em, household, line.name ?? `Category ${index}`));
    categories.push(category);
    for (const month of line.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const row = em.create(BudgetTemplateCategory, { amountBudgeted: line.amount, budgetKey: budget, categoryKey: category, month, recurrency: line.recurrency, rolloverEnabled: line.rolloverEnabled ?? false, year: line.year }, { partial: true });
      if (line.accounts) row.accounts.add(line.accounts);
    }
  }
  await em.flush();
  return { budget, categories };
}

/** Every stored row of a budget (deleted budgets and other tenants included), oldest month first, with its account links. */
export function budgetRows(em: EntityManager, budgetKey: number, where: { year?: number } = {}) {
  return em.find(BudgetTemplateCategory, { budgetKey: { budgetKey }, ...where }, { filters: false, orderBy: [{ year: 'asc' }, { month: 'asc' }, { categoryKey: 'asc' }], populate: ['accounts'] });
}
