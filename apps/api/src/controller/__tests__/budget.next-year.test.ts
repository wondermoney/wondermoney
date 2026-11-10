import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addBudget, budgetRows } from '@app/__tests__/__helpers__/budget-fixtures';
import { addCategory, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import budgetRoutes from '@route/budget';
import { Recurrency } from '@utils/budget';

/*
 * A budget is stored a year at a time. Asking for a month of a year it does not have yet (up to
 * next year) starts that year as a copy of December, so the budget keeps going past New Year.
 */
describe('a budget in the next year', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/budget', budgetRoutes);

  const today = (iso: string) => vi.setSystemTime(new Date(iso));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    today('2026-12-10T12:00:00Z');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function householdWithBudget() {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    const { budget, categories } = await addBudget(em, household, {
      lines: [{ accounts: [household.account], amount: 250, category: groceries, recurrency: Recurrency.MONTHLY, year: 2026 }],
    });
    return { budget, category: categories[0]!, household };
  }

  it('opens January of next year with the budget copied from December', async () => {
    const { budget, household } = await householdWithBudget();

    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/2027/1`);

    expect(response.status).toBe(200);
    expect(response.body.budget).toMatchObject({ accounts: [{ accountKey: household.account.accountKey }], month: 1, year: 2027 });
    expect(response.body.budget.categories).toEqual(expect.arrayContaining([expect.objectContaining({ category_budgeted_amount: 250, child_category_name: 'Groceries' })]));
    expect(response.body.hasPreviousMonth).toBe(true);
    expect(await budgetRows(db.em(), budget.budgetKey, { year: 2027 })).toHaveLength(12);
  });

  it('offers a next month from December of this year through November of next year, and not past December of next year', async () => {
    const { budget, household } = await householdWithBudget();
    const month = (year: number, m: number) => http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/${year}/${m}`);

    const thisDecember = await month(2026, 12);
    const nextNovember = await month(2027, 11);
    const nextDecember = await month(2027, 12);

    expect(thisDecember.body.hasNextMonth).toBe(true);
    expect(nextNovember.body.hasNextMonth).toBe(true);
    expect(nextDecember.status).toBe(200);
    expect(nextDecember.body.hasNextMonth).toBe(false);
  });

  it('does not create a budget more than a year ahead', async () => {
    const { budget, household } = await householdWithBudget();

    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/2028/1`);

    expect(response.status).toBe(404);
    expect(await budgetRows(db.em(), budget.budgetKey, { year: 2028 })).toHaveLength(0);
  });

  it('returns 404 for another household\'s budget in next year and creates nothing for it', async () => {
    const { household: ours } = await householdWithBudget();
    const { budget: theirBudget } = await householdWithBudget();

    const response = await http.as(ours.appuser).get(`/v1/budget/${theirBudget.budgetKey}/2027/1`);

    expect(response.status).toBe(404);
    expect(await budgetRows(db.em(), theirBudget.budgetKey, { year: 2027 })).toHaveLength(0);
  });

  it('opens the year view of next year', async () => {
    const { budget, household } = await householdWithBudget();

    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/2027`);

    expect(response.status).toBe(200);
    expect(response.body.budget.year).toBe(2027);
  });

  it('lists the budget for this month on 1 January even if the yearly extension never ran', async () => {
    const { budget, household } = await householdWithBudget();
    today('2027-01-01T09:00:00Z');

    const response = await http.as(household.appuser).get('/v1/budget/full');

    expect(response.status).toBe(200);
    expect(response.body.budgets).toEqual([expect.objectContaining({ budgetKey: budget.budgetKey, month: 1, year: 2027 })]);
  });

  it('applies an edit to the following months of this year and of next year', async () => {
    const { budget, category, household } = await householdWithBudget();
    await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/2027/1`);

    const response = await http.as(household.appuser).patch(`/v1/budget/${budget.budgetKey}/2026/11/${category.categoryKey}`).send({ amount: 400, applyToFollowingMonths: true });

    expect(response.status).toBe(200);
    const rows = await budgetRows(db.em(), budget.budgetKey);
    const amount = (year: number, month: number) => rows.find((row) => row.year === year && row.month === month)?.amountBudgeted;
    expect(amount(2026, 10)).toBe(250);
    expect(amount(2026, 11)).toBe(400);
    expect(amount(2026, 12)).toBe(400);
    for (let month = 1; month <= 12; month += 1) expect(amount(2027, month)).toBe(400);
  });

  it('still applies an edit to one month only when asked', async () => {
    const { budget, category, household } = await householdWithBudget();
    await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/2027/1`);

    await http.as(household.appuser).patch(`/v1/budget/${budget.budgetKey}/2026/12/${category.categoryKey}`).send({ amount: 400, applyToFollowingMonths: false });

    const rows = await budgetRows(db.em(), budget.budgetKey);
    expect(rows.filter((row) => row.amountBudgeted === 400).map((row) => [row.year, row.month])).toEqual([[2026, 12]]);
  });

  it('adds a new category to next year too once next year exists', async () => {
    const { budget, household } = await householdWithBudget();
    await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/2027/1`);
    const gifts = await addCategory(db.em(), household, 'Gifts');

    const response = await http.as(household.appuser).post(`/v1/budget/${budget.budgetKey}/category`).send({ amountBudgeted: 40, categoryKey: gifts.categoryKey });

    expect(response.status).toBe(201);
    const giftRows = (await budgetRows(db.em(), budget.budgetKey)).filter((row) => row.categoryKey.categoryKey === gifts.categoryKey);
    expect(giftRows.filter((row) => row.year === 2026)).toHaveLength(12);
    expect(giftRows.filter((row) => row.year === 2027)).toHaveLength(12);
  });
});
