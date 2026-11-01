import { describe, expect, it, vi } from 'vitest';

import { addCategory, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getBudgetSpending } from '../spending';

/*
 * A budget category's spending is the sum of its transactions, however many accounts the
 * budget's categories are linked to. Account links say which accounts count, not how often.
 */
describe('monthly budget spending and linked accounts', () => {
  const db = useTestDatabase();

  it.each([1, 2, 3])('counts a transaction once when a budget row is linked to %i account(s)', async (accountCount) => {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    const accounts = [household.account];
    for (let index = 1; index < accountCount; index += 1) {
      accounts.push(em.create(Account, { accountName: `Account ${index}`, accountOwnerAppuserKey: household.appuser, balance: 0, closed: false, currencyKey: household.currency, isPrivate: false, tenantKey: household.tenant }, { partial: true }));
    }
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    // Keys are serial in production, so some budget row's key always equals some budget's key.
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 100, budgetKey: budget, budgetTemplateCategoryKey: budget.budgetKey, categoryKey: groceries, month: 7, year: 2026 }, { partial: true });
    template.accounts.add(accounts);
    await em.flush();
    await addTransaction(em, household, { amount: -10, category: groceries, date: new Date('2026-07-15T12:00:00Z'), status: 'BOOKED' });

    const rows = await getBudgetSpending({ accountKeys: accounts.map((account) => account.accountKey), period: 'monthly', templateKeys: [template.budgetTemplateCategoryKey], tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });

    expect(rows.find((row) => row.child_category_name === 'Groceries')).toMatchObject({ category_amount: 10 });
    expect(rows.find((row) => row.child_category_name === null && row.parent_category_name === 'Food')).toMatchObject({ category_amount: 10 });
  });
});
