import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addBudget, type BudgetLine } from '@app/__tests__/__helpers__/budget-fixtures';
import { addCategory, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Budget } from '@entity/Budget';
import type { Category } from '@entity/Category';
import budgetRoutes from '@route/budget';

interface CategoryRow {
  category_amount: number;
  category_available: number;
  category_rolled_over: number;
  child_category_name: null | string;
}

interface MonthBody {
  budget: { categories: CategoryRow[]; month: number; period: { firstDay: string; lastDay: string }; periodStartDay: number; year: number };
}

/*
 * A budget whose month starts on the 25th counts 25 October to 24 November as November. Every
 * figure of a budget month (its spending, the year it adds up to, the rollover carried into the
 * next month and which month is the current one) uses those days.
 */
describe('budget month start day', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/budget', budgetRoutes);
  const at = (day: string, time = '00:00:00') => new Date(`${day}T${time}.000Z`);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(periodStartDay: number, lines: Omit<BudgetLine, 'category'>[] = [{ amount: 100, year: 2026 }]) {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    const { budget } = await addBudget(em, household, { lines: lines.map((line) => ({ accounts: [household.account], ...line, category: groceries })), periodStartDay });
    return { budget, em, groceries, household };
  }
  const spend = (em: EntityManager, household: Household, category: Category, amount: number, date: Date) =>
    addTransaction(em, household, { amount, category, date, status: 'BOOKED' });

  async function month(household: Household, budget: Budget, year: number, monthNumber: number) {
    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/${year}/${monthNumber}`);
    expect(response.status).toBe(200);
    return response.body as MonthBody;
  }
  const groceriesOf = (body: { budget: { categories: CategoryRow[] } }) => body.budget.categories.find((row) => row.child_category_name === 'Groceries')!;

  it('counts a transaction on 24 November in November and one on 25 November in December', async () => {
    const { budget, em, groceries, household } = await setup(25);
    await spend(em, household, groceries, -10, at('2026-11-24'));
    await spend(em, household, groceries, -20, at('2026-11-25'));

    expect(groceriesOf(await month(household, budget, 2026, 11)).category_amount).toBe(10);
    expect(groceriesOf(await month(household, budget, 2026, 12)).category_amount).toBe(20);
  });

  it('starts the month at the first instant of the start day and ends it at the last instant of the day before', async () => {
    const { budget, em, groceries, household } = await setup(25);
    await spend(em, household, groceries, -1, at('2026-10-24', '23:59:59'));
    await spend(em, household, groceries, -2, at('2026-10-25'));
    await spend(em, household, groceries, -4, at('2026-11-24', '23:59:59'));
    await spend(em, household, groceries, -8, at('2026-11-25'));

    expect(groceriesOf(await month(household, budget, 2026, 10)).category_amount).toBe(1);
    expect(groceriesOf(await month(household, budget, 2026, 11)).category_amount).toBe(6);
    expect(groceriesOf(await month(household, budget, 2026, 12)).category_amount).toBe(8);
  });

  it('counts the end of December in January of the next year', async () => {
    const { budget, em, groceries, household } = await setup(25, [{ amount: 100, months: [12], year: 2026 }, { amount: 100, months: [1], year: 2027 }]);
    await spend(em, household, groceries, -10, at('2026-12-24'));
    await spend(em, household, groceries, -20, at('2026-12-25'));

    expect(groceriesOf(await month(household, budget, 2026, 12)).category_amount).toBe(10);
    expect(groceriesOf(await month(household, budget, 2027, 1)).category_amount).toBe(20);
  });

  it('reports the month\'s days with the month', async () => {
    const { budget, household } = await setup(28);

    const february = await month(household, budget, 2026, 2);

    expect(february.budget).toMatchObject({ month: 2, period: { firstDay: '2026-01-28', lastDay: '2026-02-27' }, periodStartDay: 28, year: 2026 });
  });

  it('with start day 1 counts the calendar month, as before', async () => {
    const { budget, em, groceries, household } = await setup(1);
    await spend(em, household, groceries, -1, at('2026-10-31', '23:59:59'));
    await spend(em, household, groceries, -2, at('2026-11-01'));
    await spend(em, household, groceries, -4, at('2026-11-30', '23:59:59'));
    await spend(em, household, groceries, -8, at('2026-12-01'));

    const november = await month(household, budget, 2026, 11);

    expect(groceriesOf(november).category_amount).toBe(6);
    expect(november.budget).toMatchObject({ period: { firstDay: '2026-11-01', lastDay: '2026-11-30' }, periodStartDay: 1 });
  });

  it('adds the year up from each month\'s own days', async () => {
    const { budget, em, groceries, household } = await setup(25);
    // Before January 2026 began (25 December 2025), and on the last day of December 2026.
    await spend(em, household, groceries, -1, at('2025-12-24'));
    await spend(em, household, groceries, -2, at('2025-12-25'));
    await spend(em, household, groceries, -4, at('2026-12-24'));
    await spend(em, household, groceries, -8, at('2026-12-25'));

    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/2026`);

    expect(response.status).toBe(200);
    expect(groceriesOf(response.body as MonthBody).category_amount).toBe(6);
  });

  it('carries into the next month what the month left over on its own days', async () => {
    const { budget, em, groceries, household } = await setup(25, [{ amount: 100, months: [11, 12], rolloverEnabled: true, year: 2026 }]);
    await spend(em, household, groceries, -30, at('2026-11-24'));
    // In December already: not part of November's carry.
    await spend(em, household, groceries, -50, at('2026-11-25'));

    const december = groceriesOf(await month(household, budget, 2026, 12));

    expect(december).toMatchObject({ category_amount: 50, category_available: 170, category_rolled_over: 70 });
  });

  it('lists a budget in the budget month today is in', async () => {
    vi.setSystemTime(new Date('2026-11-26T09:00:00Z'));
    const { budget, em, groceries, household } = await setup(25);
    await spend(em, household, groceries, -10, at('2026-11-24'));
    await spend(em, household, groceries, -20, at('2026-11-25'));

    const response = await http.as(household.appuser).get('/v1/budget/full');

    expect(response.status).toBe(200);
    const [listed] = (response.body as { budgets: (MonthBody['budget'] & { budgetKey: number })[] }).budgets;
    expect(listed).toMatchObject({ budgetKey: budget.budgetKey, month: 12, period: { firstDay: '2026-11-25', lastDay: '2026-12-24' }, periodStartDay: 25, year: 2026 });
    expect(groceriesOf({ budget: listed! }).category_amount).toBe(20);
  });

  it('suggests limits from the complete budget months before the target month, on their own days', async () => {
    vi.setSystemTime(new Date('2026-11-26T09:00:00Z'));
    const { budget, em, groceries, household } = await setup(25);
    // September (25 August to 24 September), October and November each spend 100.
    await spend(em, household, groceries, -100, at('2026-09-01'));
    await spend(em, household, groceries, -100, at('2026-10-01'));
    await spend(em, household, groceries, -100, at('2026-11-24'));
    // In December, the month being planned: not part of the window.
    await spend(em, household, groceries, -1000, at('2026-11-25'));

    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/suggestions?year=2026&month=12&months=3`);

    expect(response.status).toBe(200);
    const [suggestion] = (response.body as { categories: { average: number; monthsWithData: number }[] }).categories;
    expect(suggestion).toMatchObject({ average: 100, monthsWithData: 3 });
  });

  it('forecasts from the budget month today is in, with its spending so far', async () => {
    vi.setSystemTime(new Date('2026-11-26T09:00:00Z'));
    const { budget, em, groceries, household } = await setup(25);
    await spend(em, household, groceries, -10, at('2026-11-24'));
    await spend(em, household, groceries, -20, at('2026-11-25'));

    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/forecast?months=3`);

    expect(response.status).toBe(200);
    const { months } = response.body as { months: { kind: string; month: number; spent: null | number; year: number }[] };
    expect(months.map(({ month: m, year }) => [year, m])).toEqual([[2026, 12], [2027, 1], [2027, 2]]);
    expect(months[0]).toMatchObject({ kind: 'current', spent: 20 });
  });

  describe('setting it', () => {
    it('reads and changes the start day of a budget', async () => {
      const { budget, household } = await setup(1);

      const saved = await http.as(household.appuser).patch(`/v1/budget/${budget.budgetKey}`).send({ periodStartDay: 25 });
      const read = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}`);

      expect(saved.status).toBe(200);
      expect(read.body).toMatchObject({ budget: { name: 'Home', periodStartDay: 25 } });
      const stored = await db.em().findOneOrFail(Budget, { budgetKey: budget.budgetKey }, { filters: false });
      expect(stored).toMatchObject({ name: 'Home', periodStartDay: 25, rolloverCarriesOverspend: true });
    });

    it.each([0, 29, 31, 1.5])('refuses start day %s', async (periodStartDay) => {
      const { budget, household } = await setup(1);

      const response = await http.as(household.appuser).patch(`/v1/budget/${budget.budgetKey}`).send({ periodStartDay });

      expect(response.status).toBe(400);
      const stored = await db.em().findOneOrFail(Budget, { budgetKey: budget.budgetKey }, { filters: false });
      expect(stored.periodStartDay).toBe(1);
    });

    it('cannot be stored outside 1 to 28, whatever writes it', async () => {
      const { budget } = await setup(1);

      await expect(db.em().getConnection().execute('update budget set period_start_day = 29 where budget_key = ?', [budget.budgetKey])).rejects.toThrow(/budget_period_start_day_check/u);
    });
  });
});
