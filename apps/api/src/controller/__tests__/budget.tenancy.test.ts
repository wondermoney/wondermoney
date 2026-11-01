import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addCategory, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import budgetRoutes from '@route/budget';

/*
 * A budget belongs to one household. Another household editing or deleting it gets the same 404
 * as for a budget that does not exist, and the budget is left as it was.
 */
describe('budgets of another household', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/budget', budgetRoutes);

  async function addBudget(household: Household, name: string) {
    const em = db.em();
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name, tenantKey: household.tenant }, { partial: true });
    const category = await addCategory(em, household, `${name} groceries`);
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 100, budgetKey: budget, categoryKey: category, month: 1, year: 2026 }, { partial: true });
    await em.flush();
    return { budget, template };
  }

  async function twoHouseholds() {
    const ours = await seedHousehold(db.em());
    const theirs = await seedHousehold(db.em());
    return { ourBudget: await addBudget(ours, 'Ours'), ours, theirBudget: await addBudget(theirs, 'Theirs'), theirs };
  }

  const storedBudget = (budgetKey: number) => db.em().findOneOrFail(Budget, { budgetKey }, { filters: false });

  it('returns 404 for editing another household\'s budget and leaves it unchanged', async () => {
    const { ours, theirBudget } = await twoHouseholds();

    const response = await http.as(ours.appuser).patch(`/v1/budget/${theirBudget.budget.budgetKey}`).send({ name: 'Taken over' });

    expect(response.status).toBe(404);
    await expect(storedBudget(theirBudget.budget.budgetKey)).resolves.toMatchObject({ name: 'Theirs' });
  });

  it('returns 404 for deleting another household\'s budget and leaves it in place', async () => {
    const { ours, theirBudget } = await twoHouseholds();

    const response = await http.as(ours.appuser).delete(`/v1/budget/${theirBudget.budget.budgetKey}`);

    expect(response.status).toBe(404);
    await expect(storedBudget(theirBudget.budget.budgetKey)).resolves.toMatchObject({ deletedAt: null });
  });

  it('returns 404 for another household\'s budget category under one\'s own budget', async () => {
    const { ourBudget, ours, theirBudget } = await twoHouseholds();

    const response = await http.as(ours.appuser).patch(`/v1/budget/${ourBudget.budget.budgetKey}/${theirBudget.template.budgetTemplateCategoryKey}`).send({ accountKeys: [ours.account.accountKey] });

    expect(response.status).toBe(404);
  });

  it('still edits and deletes the household\'s own budget', async () => {
    const { ourBudget, ours } = await twoHouseholds();

    expect((await http.as(ours.appuser).patch(`/v1/budget/${ourBudget.budget.budgetKey}`).send({ name: 'Renamed' })).status).toBe(200);
    await expect(storedBudget(ourBudget.budget.budgetKey)).resolves.toMatchObject({ name: 'Renamed' });
    expect((await http.as(ours.appuser).delete(`/v1/budget/${ourBudget.budget.budgetKey}`)).status).toBe(200);
    await expect(storedBudget(ourBudget.budget.budgetKey)).resolves.toMatchObject({ deletedAt: expect.any(Date) });
  });
});
