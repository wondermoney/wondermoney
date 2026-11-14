import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addBudget } from '@app/__tests__/__helpers__/budget-fixtures';
import { addAccount, addCategory, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import budgetRoutes from '@route/budget';

interface SuggestionBody {
  categories: {
    average: number;
    categoryKey: number;
    categoryName: string;
    hasEnoughData: boolean;
    median: number;
    monthsWithData: number;
    suggested: null | number;
  }[];
  currencyCode: string;
  months: number;
  targetMonth: { month: number; year: number };
}

/*
 * Suggestions come from the household's own complete months of spending: the median of those
 * months rounded up to five, with refunds netted, a partial current month left out, and a
 * partner's private account invisible.
 */
describe('budget suggestions', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/budget', budgetRoutes);
  const on = (year: number, month: number, day = 10) => new Date(Date.UTC(year, month - 1, day, 12));

  async function setup() {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    const transport = await addCategory(em, household, 'Transport', food);
    const { budget } = await addBudget(em, household, {
      lines: [
        { accounts: [household.account], amount: 100, category: groceries, year: 2026 },
        { accounts: [household.account], amount: 50, category: transport, year: 2026 },
      ],
    });
    return { budget, em, groceries, household, transport };
  }

  async function suggestions(household: Awaited<ReturnType<typeof seedHousehold>>, budgetKey: number, query = 'year=2026&month=11&months=3') {
    const response = await http.as(household.appuser).get(`/v1/budget/${budgetKey}/suggestions?${query}`);
    expect(response.status).toBe(200);
    return response.body as SuggestionBody;
  }

  it('suggests the median of complete months, rounded up, and ignores an outlier month', async () => {
    const { budget, em, groceries, household } = await setup();
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 8), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 9), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -1000, category: groceries, date: on(2026, 10), status: 'BOOKED' });

    const body = await suggestions(household, budget.budgetKey);

    const groceriesSuggestion = body.categories.find((category) => category.categoryKey === groceries.categoryKey);
    expect(groceriesSuggestion).toMatchObject({
      average: 400,
      hasEnoughData: true,
      median: 100,
      monthsWithData: 3,
      suggested: 100,
    });
    expect(body).toMatchObject({ currencyCode: 'EUR', months: 3, targetMonth: { month: 11, year: 2026 } });
  });

  it('excludes the partial current month from the window', async () => {
    const { budget, em, groceries, household } = await setup();
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 8), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 9), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 10), status: 'BOOKED' });
    // November is the month being budgeted and is still running: it must not move the suggestion.
    await addTransaction(em, household, { amount: -5000, category: groceries, date: on(2026, 11, 2), status: 'BOOKED' });

    const body = await suggestions(household, budget.budgetKey);

    expect(body.categories.find((category) => category.categoryKey === groceries.categoryKey)).toMatchObject({ median: 100, suggested: 100 });
  });

  it('nets refunds against their month, and a refund-only month spent nothing', async () => {
    const { budget, em, groceries, household } = await setup();
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 8), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 9), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, 10), status: 'BOOKED' });
    await addTransaction(em, household, { amount: 50, category: groceries, date: on(2026, 10, 12), status: 'BOOKED' });

    const body = await suggestions(household, budget.budgetKey);

    // October spent 100 net of a 50 refund: 50. Median of 100, 100, 50 is 100.
    expect(body.categories.find((category) => category.categoryKey === groceries.categoryKey)).toMatchObject({ average: 83.3333, median: 100, monthsWithData: 3 });
  });

  it('leaves out a partner\'s private account', async () => {
    const { budget, em, groceries, household } = await setup();
    const partner = await addPartner(em, household);
    const hidden = await addAccount(em, household, { isPrivate: true, owner: partner });
    const templates = await em.find(BudgetTemplateCategory, { budgetKey: budget }, { populate: ['accounts'] });
    for (const template of templates) template.accounts.add(hidden);
    await em.flush();
    for (const month of [8, 9, 10]) {
      await addTransaction(em, household, { account: hidden, amount: -1000, appuser: partner, category: groceries, date: on(2026, month), status: 'BOOKED' });
      await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, month), status: 'BOOKED' });
    }

    const body = await suggestions(household, budget.budgetKey);

    expect(body.categories.find((category) => category.categoryKey === groceries.categoryKey)).toMatchObject({ median: 100, suggested: 100 });
  });

  it('flags a category with too little history instead of suggesting', async () => {
    const { budget, em, groceries, household, transport } = await setup();
    for (const month of [8, 9, 10]) {
      await addTransaction(em, household, { amount: -100, category: groceries, date: on(2026, month), status: 'BOOKED' });
    }
    await addTransaction(em, household, { amount: -80, category: transport, date: on(2026, 10), status: 'BOOKED' });

    const body = await suggestions(household, budget.budgetKey);

    expect(body.categories.find((category) => category.categoryKey === transport.categoryKey)).toMatchObject({ hasEnoughData: false, monthsWithData: 1, suggested: null });
  });

  it('accepts 3, 6 or 12 complete months and rejects anything else', async () => {
    const { budget, household } = await setup();

    for (const months of [3, 6, 12]) {
      expect((await suggestions(household, budget.budgetKey, `year=2026&month=11&months=${months}`)).months).toBe(months);
    }
    for (const query of ['year=2026&month=11&months=2', 'year=2026&month=11&months=13', 'month=11', 'year=2026']) {
      const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/suggestions?${query}`);
      expect(response.status).toBe(400);
    }
  });

  it('returns 404 for another household\'s budget', async () => {
    const { budget } = await setup();
    const stranger = await seedHousehold(db.em());

    const response = await http.as(stranger.appuser).get(`/v1/budget/${budget.budgetKey}/suggestions?year=2026&month=11&months=3`);

    expect(response.status).toBe(404);
  });
});
