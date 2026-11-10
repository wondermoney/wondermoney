import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { TENANT_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Category } from '@entity/Category';
import { getRef } from '@utils/em-helpers';

export interface BudgetYearTarget {
  budgetKey: number;
  /** The household the budget must belong to. Checked explicitly, so a worker EM without a tenant filter stays scoped. */
  tenantKey: number;
  year: number;
}

/**
 * Give a budget its rows for `year`, copied from the December before: one row per category for
 * each of the twelve months, with December's amount, recurrency, rollover setting and linked accounts.
 *
 * A year that already has any row is left as it is, so a month or category removed from it is
 * not brought back. Two calls racing for the same year both see an empty year; the unique
 * `(budget, category, year, month)` constraint rejects the second insert, which then counts as
 * done. Returns the number of rows created.
 */
export async function ensureBudgetYear(em: EntityManager, { budgetKey, tenantKey, year }: BudgetYearTarget): Promise<number> {
  const work = em.fork();
  const budget = await work.findOne(Budget, { budgetKey, deletedAt: null, tenantKey: { tenantKey } }, { fields: ['budgetKey'] });
  if (!budget) return 0;

  if ((await work.count(BudgetTemplateCategory, { budgetKey: { budgetKey }, year })) > 0) return 0;

  // The budget is this tenant's (checked above). Its December links are copied whole: the
  // request's privacy filter would hide a partner's private account and drop its link.
  const december = await work.find(
    BudgetTemplateCategory,
    { budgetKey: { budgetKey }, month: 12, year: year - 1 },
    { filters: { [TENANT_FILTER]: false }, populate: ['accounts'] },
  );
  if (december.length === 0) return 0;

  const writer = em.fork();
  for (const source of december) {
    const accountKeys = source.accounts.getItems().map((account) => account.accountKey);
    for (let month = 1; month <= 12; month += 1) {
      const row = writer.create(BudgetTemplateCategory, {
        amountBudgeted: source.amountBudgeted,
        budgetKey: getRef(writer, Budget, budgetKey),
        categoryKey: getRef(writer, Category, source.categoryKey.categoryKey),
        month,
        recurrency: source.recurrency,
        rolloverEnabled: source.rolloverEnabled,
        year,
      }, { partial: true });
      row.accounts.add(accountKeys.map((accountKey) => getRef(writer, Account, accountKey)));
    }
  }

  try {
    await writer.flush();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) return 0;
    throw error;
  }
  return december.length * 12;
}
