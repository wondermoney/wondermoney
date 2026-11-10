import { describe, expect, it } from 'vitest';

import { addCategory, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';

import { ensureInvestmentsAndSavingsCategory } from '../InvestmentsAndSavingsCategorySeeder';

/*
 * "Investments and savings" is a system category, shared by every household, that does not count
 * as spending. A database that already has its households and categories gets it on the next
 * start, once, and nothing already categorized moves into it.
 */
describe('the "Investments and savings" system category', () => {
  const db = useTestDatabase();

  const systemCategories = () => db.em().find(Category, { isSystemCategory: true, tenantKey: null }, { filters: false, orderBy: { categoryKey: 'asc' }, populate: ['parentCategory'] });

  it('is added once, with its children, none of them counting as spending', async () => {
    await ensureInvestmentsAndSavingsCategory(db.em());
    await ensureInvestmentsAndSavingsCategory(db.em());

    const categories = await systemCategories();
    expect(categories.map((category) => [category.name, category.parentCategory?.name ?? null, category.countsAsSpending])).toEqual([
      ['INVESTMENTS_AND_SAVINGS', null, false],
      ['INVESTMENTS', 'INVESTMENTS_AND_SAVINGS', false],
      ['SAVINGS', 'INVESTMENTS_AND_SAVINGS', false],
    ]);
  });

  it('is visible to every household, existing ones included, and recategorizes nothing', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const theirInvestments = await addCategory(em, household, 'INVESTMENTS');
    const transaction = await addTransaction(em, household, { amount: -200, category: theirInvestments, date: new Date('2026-07-10T12:00:00Z'), status: 'BOOKED' });

    await ensureInvestmentsAndSavingsCategory(db.em());

    // The household's own category of the same name is not the system one, and is left as it was.
    expect((await systemCategories()).filter((category) => category.name === 'INVESTMENTS')).toHaveLength(1);
    const stored = await db.em().findOneOrFail(Category, { categoryKey: theirInvestments.categoryKey }, { filters: false });
    expect(stored.countsAsSpending).toBe(true);
    const assignments = await db.em().find(AppuserTransactionCategory, { transactionKey: { transactionKey: transaction.transactionKey } }, { filters: false });
    expect(assignments.map((assignment) => assignment.categoryKey.categoryKey)).toEqual([theirInvestments.categoryKey]);
  });

  it('adds a missing child to a parent that is already there', async () => {
    await ensureInvestmentsAndSavingsCategory(db.em());
    const em = db.em();
    const savings = await em.findOneOrFail(Category, { isSystemCategory: true, name: 'SAVINGS', tenantKey: null }, { filters: false });
    await em.remove(savings).flush();

    await ensureInvestmentsAndSavingsCategory(db.em());

    expect((await systemCategories()).map((category) => category.name)).toEqual(['INVESTMENTS_AND_SAVINGS', 'INVESTMENTS', 'SAVINGS']);
  });
});
