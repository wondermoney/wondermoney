import { describe, expect, it } from 'vitest';

import { addCategory, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Category } from '@entity/Category';

import { categoryLinesSql } from '../category-lines';
import { loadCategorySpendingFlags, setCategoryCountsAsSpending } from '../category-spending';

/*
 * Whether a category counts as spending is a household's choice, for its own categories and for the
 * built-in ones alike. A built-in category is one global row shared by every household, so a
 * household's choice for it is kept on the side and never reaches another household. Without a
 * choice, a category counts as its own flag says ("Investments and savings" does not, the rest do).
 * A category under one that does not count never counts, whatever its own value.
 */
describe('whether a category counts as spending for a household', () => {
  const db = useTestDatabase();
  const JULY_10 = new Date('2026-07-10T12:00:00Z');

  async function setup() {
    const em = db.em();
    const ours = await seedHousehold(em);
    const theirs = await seedHousehold(em);
    const system = (name: string, countsAsSpending: boolean, parentCategory?: Category) =>
      em.create(Category, { bgColor: '#000', countsAsSpending, isSystemCategory: true, name, parentCategory, textColor: '#fff' }, { partial: true });
    const investments = system('INVESTMENTS_AND_SAVINGS', false);
    const savings = system('SAVINGS', false, investments);
    const groceries = system('GROCERIES', true);
    await em.flush();
    return { groceries, investments, ours, savings, theirs };
  }

  /** The effective value of each category for `household`, in JavaScript and in SQL. */
  async function effective(household: Household, categories: Category[]) {
    const em = db.em();
    const flags = await loadCategorySpendingFlags(em, household.tenant.tenantKey);
    const loaded = await em.find(Category, { categoryKey: { $in: categories.map((category) => category.categoryKey) } }, { filters: false, populate: ['parentCategory'] });
    const js = Object.fromEntries(loaded.map((category) => [category.name, flags.countsAsSpending(category)]));

    for (const category of categories) await addTransaction(em, household, { amount: -10, category, date: JULY_10, status: 'BOOKED' });
    const rows = await em.getConnection().execute<{ counts_as_spending: boolean; name: string }[]>(
      `select c.name, line.counts_as_spending from ${categoryLinesSql(household.tenant.tenantKey)} line
       join "transaction" t on t.transaction_key = line.transaction_key
       join "category" c on c.category_key = line.category_key
       where t.tenant_key = ?`,
      [household.tenant.tenantKey],
    );
    const sql = Object.fromEntries(rows.map((row) => [row.name, row.counts_as_spending]));
    expect(sql).toEqual(js);
    return js;
  }

  it('is the category\'s own flag while the household has not chosen', async () => {
    const { groceries, investments, ours, savings } = await setup();

    expect(await effective(ours, [groceries, investments, savings])).toEqual({ GROCERIES: true, INVESTMENTS_AND_SAVINGS: false, SAVINGS: false });
  });

  it('follows the household\'s choice for a built-in category, either way', async () => {
    const { groceries, investments, ours } = await setup();

    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, groceries.categoryKey, false);
    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, investments.categoryKey, true);

    expect(await effective(ours, [groceries, investments])).toEqual({ GROCERIES: false, INVESTMENTS_AND_SAVINGS: true });
  });

  it('switches a category\'s children with it', async () => {
    const { investments, ours, savings } = await setup();

    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, investments.categoryKey, true);
    expect(await effective(ours, [investments, savings])).toEqual({ INVESTMENTS_AND_SAVINGS: true, SAVINGS: true });

    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, investments.categoryKey, false);
    expect((await loadCategorySpendingFlags(db.em(), ours.tenant.tenantKey)).countsAsSpending(await db.em().findOneOrFail(Category, { categoryKey: savings.categoryKey }, { populate: ['parentCategory'] }))).toBe(false);
  });

  it('never counts a child of a category that does not count, whatever the child says', async () => {
    const { investments, ours, savings } = await setup();

    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, savings.categoryKey, true);

    expect(await effective(ours, [investments, savings])).toEqual({ INVESTMENTS_AND_SAVINGS: false, SAVINGS: false });
  });

  it('applies to a household\'s own category under a built-in one', async () => {
    const { investments, ours } = await setup();
    const broker = await addCategory(db.em(), ours, 'Broker', await db.em().findOneOrFail(Category, { categoryKey: investments.categoryKey }));

    expect(await effective(ours, [broker])).toEqual({ Broker: false });
    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, investments.categoryKey, true);
    expect(await effective(ours, [broker])).toEqual({ Broker: true });
  });

  it('never reaches another household', async () => {
    const { groceries, investments, ours, savings, theirs } = await setup();

    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, groceries.categoryKey, false);
    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, investments.categoryKey, true);

    expect(await effective(theirs, [groceries, investments, savings])).toEqual({ GROCERIES: true, INVESTMENTS_AND_SAVINGS: false, SAVINGS: false });
    const stored = await db.em().find(Category, { isSystemCategory: true }, { filters: false });
    expect(Object.fromEntries(stored.map((category) => [category.name, category.countsAsSpending]))).toEqual({ GROCERIES: true, INVESTMENTS_AND_SAVINGS: false, SAVINGS: false });
  });

  it('keeps one choice per household and category', async () => {
    const { groceries, ours } = await setup();

    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, groceries.categoryKey, false);
    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, groceries.categoryKey, true);
    await setCategoryCountsAsSpending(db.em(), ours.tenant.tenantKey, groceries.categoryKey, false);

    const [row] = await db.em().getConnection().execute<{ count: string }[]>('select count(*) from tenant_category_setting where tenant_key = ?', [ours.tenant.tenantKey]);
    expect(Number(row?.count)).toBe(1);
    expect(await effective(ours, [groceries])).toEqual({ GROCERIES: false });
  });
});
