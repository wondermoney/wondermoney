import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addAccount, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Category } from '@entity/Category';
import insightsRoutes from '@route/insights';
import reportsRoutes from '@route/reports';

/*
 * Deterministic insights over a real database: the route, the aggregation repository and the
 * privacy rule together. A past month is read as a complete month, so the figures do not depend on
 * the day the suite runs.
 */
describe('GET /v1/insights', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });
  useRequestContextEm(db);
  const http = tenantHttp('/v1/insights', insightsRoutes);
  const reports = tenantHttp('/v1/reports', reportsRoutes);

  async function addCategories(household: Household, options: { system?: boolean } = {}) {
    const em = db.em();
    const owner = options.system ? undefined : household.appuser;
    const tenant = options.system ? undefined : household.tenant;
    const parent = em.create(Category, { appuserKey: owner, bgColor: '#000', isSystemCategory: options.system ?? false, name: 'Food', tenantKey: tenant, textColor: '#fff' }, { partial: true });
    const child = em.create(Category, { appuserKey: owner, bgColor: '#000', isSystemCategory: options.system ?? false, name: 'Groceries', parentCategory: parent, tenantKey: tenant, textColor: '#fff' }, { partial: true });
    await em.flush();
    return { child, parent };
  }

  async function addMonthlyPlan(household: Household, category: Category, amountBudgeted: number) {
    const em = db.em();
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Plan', tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted, budgetKey: budget, categoryKey: category, month: 8, year: 2026 }, { partial: true });
    template.accounts.add(household.account);
    await em.flush();
    return budget;
  }

  it('returns both insight types with stable ids for a past month', async () => {
    const household = await seedHousehold(db.em());
    const { child } = await addCategories(household);
    await addMonthlyPlan(household, child, 250);

    for (const date of ['2026-05-10', '2026-06-10', '2026-07-10']) {
      await addTransaction(db.em(), household, { amount: -100, category: child, date: new Date(`${date}T12:00:00Z`), status: 'BOOKED' });
    }
    await addTransaction(db.em(), household, { amount: -300, category: child, date: new Date('2026-08-10T12:00:00Z'), status: 'BOOKED' });

    const first = await http.as(household.appuser).get('/v1/insights?month=2026-08');
    expect(first.status).toBe(200);
    expect(first.body.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          facts: expect.objectContaining({ baselineAmount: '100', currency: 'EUR', currentAmount: '300', deviationPercent: '200.00' }),
          period: '2026-08',
          type: 'spending_vs_normal',
        }),
        expect.objectContaining({
          facts: expect.objectContaining({ amountBudgeted: '250', amountSpent: '300', projectedAmount: '300' }),
          period: '2026-08',
          type: 'budget_pace',
        }),
      ]),
    );

    const second = await http.as(household.appuser).get('/v1/insights?month=2026-08');
    expect(second.body.insights.map((insight: { id: string }) => insight.id)).toEqual(
      first.body.insights.map((insight: { id: string }) => insight.id),
    );
  });

  it('agrees with the cashflow report for the same month and filters', async () => {
    const household = await seedHousehold(db.em());
    const { child } = await addCategories(household);
    for (const date of ['2026-05-10', '2026-06-10', '2026-07-10']) {
      await addTransaction(db.em(), household, { amount: -100, category: child, date: new Date(`${date}T12:00:00Z`), status: 'BOOKED' });
    }
    await addTransaction(db.em(), household, { amount: -300, category: child, date: new Date('2026-08-10T12:00:00Z'), status: 'BOOKED' });

    const insights = await http.as(household.appuser).get('/v1/insights?month=2026-08');
    const cashflow = await reports.as(household.appuser).get('/v1/reports/cashflow?fromDate=2026-08-01T00:00:00.000Z&toDate=2026-09-01T00:00:00.000Z&includePending=true');
    const august = (cashflow.body.data as { expenses: number; month: string }[]).find((row) => row.month.startsWith('2026-08'));
    const spending = (insights.body.insights as { facts: { currentAmount: string }; type: string }[]).find((insight) => insight.type === 'spending_vs_normal');

    expect(cashflow.status).toBe(200);
    expect(Number(spending?.facts.currentAmount)).toBe(august?.expenses);
  });

  it('rejects a malformed month', async () => {
    const household = await seedHousehold(db.em());
    const response = await http.as(household.appuser).get('/v1/insights?month=2026-13');
    expect(response.status).toBe(400);
  });

  it('respects private accounts in both directions', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    // A system category is countable by both members, so the test measures the account privacy
    // rule rather than category ownership.
    const { child } = await addCategories(household, { system: true });
    const ownerPrivate = await addAccount(db.em(), household, { isPrivate: true, name: 'Owner private', owner: household.appuser });
    const partnerPrivate = await addAccount(db.em(), household, { isPrivate: true, name: 'Partner private', owner: partner });

    for (const date of ['2026-05-10', '2026-06-10', '2026-07-10']) {
      await addTransaction(db.em(), household, { account: ownerPrivate, amount: -100, category: child, date: new Date(`${date}T12:00:00Z`), status: 'BOOKED' });
      await addTransaction(db.em(), household, { account: household.account, amount: -100, category: child, date: new Date(`${date}T12:00:00Z`), status: 'BOOKED' });
      await addTransaction(db.em(), household, { account: partnerPrivate, amount: -100, appuser: partner, category: child, date: new Date(`${date}T12:00:00Z`), status: 'BOOKED' });
    }
    await addTransaction(db.em(), household, { account: ownerPrivate, amount: -1000, category: child, date: new Date('2026-08-10T12:00:00Z'), status: 'BOOKED' });
    await addTransaction(db.em(), household, { account: household.account, amount: -300, category: child, date: new Date('2026-08-10T12:00:00Z'), status: 'BOOKED' });
    await addTransaction(db.em(), household, { account: partnerPrivate, amount: -5000, appuser: partner, category: child, date: new Date('2026-08-10T12:00:00Z'), status: 'BOOKED' });

    const ownerView = await http.as(household.appuser).get('/v1/insights?month=2026-08');
    const partnerView = await http.as(partner).get('/v1/insights?month=2026-08');

    const spending = (body: { insights: { facts: { currentAmount?: string }; type: string }[] }) =>
      body.insights.find((insight) => insight.type === 'spending_vs_normal')?.facts.currentAmount;

    // The owner sees their own private account and the shared account, never the partner's private one.
    expect(spending(ownerView.body)).toBe('1300');
    // The partner sees their own private account only, never the owner's accounts.
    expect(spending(partnerView.body)).toBe('5000');
  });
});
