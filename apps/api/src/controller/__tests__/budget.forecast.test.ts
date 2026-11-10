import type { EntityManager } from '@mikro-orm/postgresql';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addBudget, type BudgetLine } from '@app/__tests__/__helpers__/budget-fixtures';
import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import type { Budget } from '@entity/Budget';
import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import type { Category } from '@entity/Category';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { RecurringSeries } from '@entity/RecurringSeries';
import budgetRoutes from '@route/budget';
import { RecurringAmountType, RecurringCadence, RecurringSeriesStatus } from '@service/recurring/recurring-types';
import { setCategoryCountsAsSpending } from '@service/transaction/category-spending';
import { Recurrency } from '@utils/budget';

interface ForecastBody {
  asOf: string;
  basis: { plannedIncome: { amount: number; name: string }[]; recurringItems: { amount: number; name: string; recurringSeriesKey: number }[] };
  completeness: { isComplete: boolean; unconvertedCurrencies: string[]; unconvertedRecurringItems: number };
  currencyCode: string;
  months: ForecastMonth[];
}

interface ForecastMonth {
  available: number;
  budgeted: number;
  carriedIn: number;
  complete: boolean;
  expectedSpend: number;
  income: number;
  kind: 'current' | 'future';
  month: number;
  net: number;
  projectedSpend: number;
  recurring: { amount: number; date: string; name: string; recurringSeriesKey: number }[];
  spent: null | number;
  year: number;
}

/*
 * A budget's forecast covers the current month and the months after it. The current month shows
 * what was actually spent so far; every month shows what the budget's confirmed recurring items
 * are expected to take, its planned income, and what is left. Projected figures are never
 * reported as spending, and the response says what they rest on.
 */
describe('budget forecast', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/budget', budgetRoutes);
  const on = (year: number, month: number, day = 10) => new Date(Date.UTC(year, month - 1, day, 12));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(lines: Omit<BudgetLine, 'category'>[] = [{ amount: 300, year: 2026 }], options: { rolloverCarriesOverspend?: boolean } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    const streaming = await addCategory(em, household, 'Streaming', food);
    const { budget } = await addBudget(em, household, { lines: lines.map((line) => ({ accounts: [household.account], ...line, category: groceries })), ...options });
    em.create(BudgetTemplateIncome, { amount: 2000, budgetKey: budget, name: 'Salary', recurrency: Recurrency.MONTHLY }, { partial: true });
    await em.flush();
    return { budget, em, food, groceries, household, streaming };
  }

  async function forecast(household: Household, budget: Budget, query = '?months=3') {
    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/forecast${query}`);
    expect(response.status).toBe(200);
    return response.body as ForecastBody;
  }

  it('starts at the current month with its actual spending, and gives later months none', async () => {
    const { budget, em, groceries, household } = await setup();
    await addTransaction(em, household, { amount: -120, category: groceries, date: on(2026, 11, 3), status: 'BOOKED' });

    const body = await forecast(household, budget);

    expect(body.asOf).toBe('2026-11-09');
    expect(body.currencyCode).toBe('EUR');
    expect(body.months.map((month) => [month.year, month.month, month.kind])).toEqual([[2026, 11, 'current'], [2026, 12, 'future'], [2027, 1, 'future']]);
    expect(body.months[0]).toMatchObject({ budgeted: 300, expectedSpend: 300, income: 2000, net: 1700, spent: 120 });
    expect(body.months[1]).toMatchObject({ budgeted: 300, spent: null });
    expect(body.basis.plannedIncome).toEqual([{ amount: 2000, name: 'Salary' }]);
  });

  it('reaches into next year with the budget copied from December', async () => {
    const { budget, household } = await setup([{ amount: 300, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], year: 2026 }, { amount: 450, months: [12], year: 2026 }]);

    const body = await forecast(household, budget, '?months=4');

    expect(body.months.map((month) => month.budgeted)).toEqual([300, 450, 450, 450]);
  });

  it('projects the budget\'s recurring items into the months they are expected in', async () => {
    const { budget, em, groceries, household } = await setup();
    const box = await addSeries(em, household, { amount: 45, category: groceries, name: 'Veg box', nextExpectedAt: on(2026, 11, 20) });

    const body = await forecast(household, budget);

    expect(body.months.map((month) => month.projectedSpend)).toEqual([45, 45, 45]);
    expect(body.months[0]?.recurring).toEqual([{ amount: 45, categoryKey: groceries.categoryKey, date: '2026-11-20', name: 'Veg box', recurringSeriesKey: box.recurringSeriesKey }]);
    expect(body.basis.recurringItems).toEqual([expect.objectContaining({ amount: 45, name: 'Veg box', recurringSeriesKey: box.recurringSeriesKey })]);
  });

  it('expects more than the plan when upcoming recurring items exceed it', async () => {
    const { budget, em, groceries, household } = await setup([{ amount: 100, year: 2026 }]);
    await addTransaction(em, household, { amount: -80, category: groceries, date: on(2026, 11, 3), status: 'BOOKED' });
    await addSeries(em, household, { amount: 60, category: groceries, nextExpectedAt: on(2026, 11, 20) });

    const [november] = (await forecast(household, budget)).months;

    expect(november).toMatchObject({ expectedSpend: 140, net: 1860, projectedSpend: 60, spent: 80 });
  });

  it('leaves out recurring items the budget does not cover, and ones not confirmed', async () => {
    const { budget, em, groceries, household, streaming } = await setup();
    const elsewhere = await addAccount(em, household);
    await addSeries(em, household, { amount: 10, category: streaming, nextExpectedAt: on(2026, 11, 20) });
    await addSeries(em, household, { account: elsewhere, amount: 11, category: groceries, nextExpectedAt: on(2026, 11, 20) });
    await addSeries(em, household, { amount: 12, category: groceries, nextExpectedAt: on(2026, 11, 20), status: RecurringSeriesStatus.dismissed });
    await addSeries(em, household, { amount: 13, category: groceries, confidenceScore: 50, nextExpectedAt: on(2026, 11, 20), status: RecurringSeriesStatus.candidate });
    await addSeries(em, household, { amount: 14, category: groceries, nextExpectedAt: on(2026, 11, 20), status: RecurringSeriesStatus.paused });
    const likely = await addSeries(em, household, { amount: 15, category: groceries, confidenceScore: 95, nextExpectedAt: on(2026, 11, 20), status: RecurringSeriesStatus.candidate });

    const body = await forecast(household, budget);

    expect(body.months[0]?.projectedSpend).toBe(15);
    expect(body.basis.recurringItems.map((item) => item.recurringSeriesKey)).toEqual([likely.recurringSeriesKey]);
  });

  it('leaves out recurring items in a category that does not count as spending', async () => {
    const { budget, em, groceries, household } = await setup();
    await addSeries(em, household, { amount: 45, category: groceries, nextExpectedAt: on(2026, 11, 20) });
    await setCategoryCountsAsSpending(db.em(), household.tenant.tenantKey, groceries.categoryKey, false);

    const body = await forecast(household, budget);

    expect(body.months[0]?.projectedSpend).toBe(0);
  });

  it('leaves out a partner\'s recurring item on their private account', async () => {
    const { budget, em, groceries, household } = await setup();
    const partner = await addPartner(em, household);
    const hidden = await addAccount(em, household, { isPrivate: true, owner: partner });
    const rows = await em.find((await import('@entity/BudgetTemplateCategory')).BudgetTemplateCategory, { budgetKey: budget }, { populate: ['accounts'] });
    for (const template of rows) template.accounts.add(hidden);
    await em.flush();
    await addSeries(em, household, { account: hidden, amount: 45, appuser: partner, category: groceries, nextExpectedAt: on(2026, 11, 20) });

    const body = await forecast(household, budget);

    expect(body.months[0]?.projectedSpend).toBe(0);
    expect(body.basis.recurringItems).toEqual([]);
  });

  it('converts a recurring item in another currency at the latest rate, and leaves out one with no rate', async () => {
    const { budget, em, groceries, household } = await setup();
    const usd = await currencyFor(em, 'USD');
    const gbp = await currencyFor(em, 'GBP');
    await addRate(em, usd, household.currency, 0.9, on(2026, 11, 1));
    await addRate(em, usd, household.currency, 0.8, on(2026, 11, 6));
    await addSeries(em, household, { amount: 50, category: groceries, currency: usd, nextExpectedAt: on(2026, 11, 20) });
    await addSeries(em, household, { amount: 20, category: groceries, currency: gbp, nextExpectedAt: on(2026, 11, 20) });

    const body = await forecast(household, budget);

    expect(body.months.map((month) => month.projectedSpend)).toEqual([40, 40, 40]);
    expect(body.months.every((month) => !month.complete)).toBe(true);
    expect(body.completeness).toMatchObject({ isComplete: false, unconvertedCurrencies: ['GBP'], unconvertedRecurringItems: 1 });
  });

  it('starts the current month from the carry the budget month shows, and carries a projected overspend on', async () => {
    const { budget, em, groceries, household } = await setup([{ amount: 100, months: [10, 11, 12], rolloverEnabled: true, year: 2026 }]);
    await addTransaction(em, household, { amount: -60, category: groceries, date: on(2026, 10), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -150, category: groceries, date: on(2026, 11, 3), status: 'BOOKED' });

    const [november, december] = (await forecast(household, budget)).months;

    // October left 40: November may spend 140 and has spent 150, so December starts 10 short.
    expect(november).toMatchObject({ available: 140, carriedIn: 40, expectedSpend: 150 });
    expect(december).toMatchObject({ available: 90, carriedIn: -10 });
  });

  it('asks for between 3 and 12 months, and defaults to 6', async () => {
    const { budget, household } = await setup();

    expect((await forecast(household, budget, '')).months).toHaveLength(6);
    expect((await forecast(household, budget, '?months=12')).months).toHaveLength(12);
    for (const months of ['2', '13', 'many']) {
      const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/forecast?months=${months}`);
      expect(response.status).toBe(400);
    }
  });

  it('returns 404 for another household\'s budget', async () => {
    const { budget } = await setup();
    const stranger = await seedHousehold(db.em());

    const response = await http.as(stranger.appuser).get(`/v1/budget/${budget.budgetKey}/forecast`);

    expect(response.status).toBe(404);
  });

  it('runs as many queries for twelve months as for three', async () => {
    const { budget, em, groceries, household } = await setup([{ amount: 100, rolloverEnabled: true, year: 2026 }, { amount: 100, rolloverEnabled: true, year: 2027 }]);
    const usd = await currencyFor(em, 'USD');
    await addRate(em, usd, household.currency, 0.8, on(2026, 11, 6));
    await addSeries(em, household, { amount: 50, category: groceries, currency: usd, nextExpectedAt: on(2026, 11, 20) });
    await addTransaction(em, household, { amount: -60, category: groceries, date: on(2026, 10), status: 'BOOKED' });

    const count = async (months: number) => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      await forecast(household, budget, `?months=${months}`);
      const queries = spy.mock.calls.length;
      spy.mockRestore();
      return queries;
    };

    const three = await count(3);
    expect(three).toBeGreaterThan(0);
    expect(await count(12)).toBe(three);
  });
});

async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number, date: Date) {
  em.create(ExchangeRate, { date, fromCurrency: from, rate, toCurrency: to }, { partial: true });
  await em.flush();
}

async function addSeries(
  em: EntityManager,
  household: Household,
  input: { account?: Account; amount: number; appuser?: Household['appuser']; category: Category; confidenceScore?: number; currency?: Currency; name?: string; nextExpectedAt: Date; status?: RecurringSeriesStatus },
) {
  const series = em.create(RecurringSeries, {
    accountKey: input.account ?? household.account,
    amountType: RecurringAmountType.fixed,
    appuserKey: input.appuser ?? household.appuser,
    averageAmount: input.amount,
    cadence: RecurringCadence.monthly,
    categoryKey: input.category,
    confidenceScore: input.confidenceScore ?? 100,
    currencyKey: input.currency ?? household.currency,
    displayName: input.name ?? `Series ${input.amount}`,
    expectedAmount: input.amount,
    nextExpectedAt: input.nextExpectedAt,
    normalizedMerchantKey: (input.name ?? `series-${input.amount}`).toLowerCase(),
    status: input.status ?? RecurringSeriesStatus.confirmed,
    tenantKey: household.tenant,
  }, { partial: true });
  await em.flush();
  return series;
}
