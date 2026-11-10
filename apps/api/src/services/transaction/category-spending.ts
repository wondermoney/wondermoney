import type { EntityManager } from '@mikro-orm/core';

import { Category } from '@entity/Category';
import { TenantCategorySetting } from '@entity/TenantCategorySetting';

/**
 * Whether money in a category counts as spending, for one household. The single source of truth for
 * every spending total (reports, budgets, monthly emails and budget alerts, the dashboard, the
 * assistant): in JavaScript through {@link CategorySpendingFlags}, in SQL through
 * {@link effectiveCountsAsSpendingSql} (which `categoryLinesSql` uses for its `counts_as_spending`
 * column).
 *
 * The rule:
 *
 * 1. A category's value for a household is the household's choice (`tenant_category_setting`) when
 *    it made one, else the category's own `counts_as_spending` (on, except "Investments and
 *    savings" and its children). A system category is one global row shared by every household,
 *    so a household's choice for it lives in `tenant_category_setting` and never reaches another
 *    household; a household's own category carries its choice on its own row.
 * 2. A category line counts when its category's value and its parent's are both on: a category
 *    under one that does not count never counts. Uncategorized money counts.
 */
export class CategorySpendingFlags {
  constructor(private readonly overrides: ReadonlyMap<number, boolean> = new Map()) {}

  /** The household's value for `category` itself (rule 1), ignoring its parent. */
  ownValue(category: Category): boolean {
    const override = this.overrides.get(category.categoryKey);
    if (override !== undefined) return override;
    // Read as possibly unset: a category not loaded, or a hand-built one, counts (the column default).
    return (category.countsAsSpending as boolean | undefined) !== false;
  }

  /** Whether money in `category` counts as spending for the household (rule 2). Populate the parent first. */
  countsAsSpending(category: Category | null | undefined): boolean {
    if (!category) return true;
    const parent = category.parentCategory;
    return this.ownValue(category) && (!parent || this.ownValue(parent));
  }
}

/** The household's choices, ready to answer {@link CategorySpendingFlags} questions. */
export async function loadCategorySpendingFlags(em: EntityManager, tenantKey: number): Promise<CategorySpendingFlags> {
  // Scoped explicitly, so it reads the same in a request and in a worker (no tenant filter there).
  const settings = await em.find(TenantCategorySetting, { deletedAt: null, tenantKey: { tenantKey } }, { filters: false });
  return new CategorySpendingFlags(new Map(settings.map((setting) => [setting.categoryKey.categoryKey, setting.countsAsSpending])));
}

/**
 * The SQL counterpart of {@link CategorySpendingFlags.ownValue}: the household's value for the
 * category row aliased `categoryAlias` (true when the alias is null, an uncategorized line).
 * `tenantKey` is inlined, validated as an integer.
 */
export function effectiveCountsAsSpendingSql(categoryAlias: string, tenantKey: number): string {
  if (!Number.isSafeInteger(tenantKey)) throw new TypeError('tenantKey must be an integer');
  return `coalesce((select setting.counts_as_spending from "tenant_category_setting" setting
      where setting.tenant_key = ${tenantKey} and setting.category_key = ${categoryAlias}.category_key and setting.deleted_at is null),
    ${categoryAlias}.counts_as_spending, true)`;
}

/**
 * Set whether `categoryKey` counts as spending for the household `tenantKey`, and the same for each
 * of its children, so switching "Investments and savings" back on makes its whole tree count
 * again. A system category gets the household's choice in `tenant_category_setting`; the
 * household's own category gets it on its row. Another household's category is never touched.
 *
 * Returns the category, or null when the household cannot use it (another household's, deleted,
 * missing). The caller flushes nothing: this writes and flushes itself.
 */
export async function setCategoryCountsAsSpending(em: EntityManager, tenantKey: number, categoryKey: number, countsAsSpending: boolean): Promise<Category | null> {
  const usable = [
    { isSystemCategory: true, tenantKey: null },
    { isSystemCategory: false, tenantKey: { tenantKey } },
  ];
  const category = await em.findOne(Category, { $or: usable, categoryKey, deletedAt: null }, { filters: false });
  if (!category) return null;
  const children = await em.find(Category, { $or: usable, deletedAt: null, parentCategory: category }, { filters: false });

  for (const target of [category, ...children]) {
    if (target.isSystemCategory) {
      await em.getConnection().execute(
        `insert into "tenant_category_setting" (tenant_key, category_key, counts_as_spending, created_at, updated_at)
         values (?, ?, ?, now(), now())
         on conflict (tenant_key, category_key)
         do update set counts_as_spending = excluded.counts_as_spending, updated_at = now(), deleted_at = null`,
        [tenantKey, target.categoryKey, countsAsSpending],
      );
    } else {
      target.countsAsSpending = countsAsSpending;
    }
  }
  await em.flush();
  return category;
}
