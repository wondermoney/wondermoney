import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addBudget, type BudgetLine, budgetRows } from '@app/__tests__/__helpers__/budget-fixtures';
import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import type { Category } from '@entity/Category';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import budgetRoutes from '@route/budget';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';
import { Recurrency } from '@utils/budget';

interface CategoryRow {
  category_amount: number;
  category_available: number;
  category_budgeted_amount: number;
  category_rolled_over: number;
  category_rollover_enabled: boolean;
  category_rollover_incomplete: boolean;
  child_category_name: null | string;
  parent_category_name: string;
}

/*
 * With rollover on, what a category left unspent last month is added to this month's budget, and
 * what it overspent is taken off. "Spent" is exactly what the budget month shows: the same
 * converted, split-aware, transfer-free figure. The carried amount is worked out when the month is
 * read, so editing an old transaction changes it at once.
 */
describe('budget rollover', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/budget', budgetRoutes);
  const on = (year: number, month: number, day = 10) => new Date(Date.UTC(year, month - 1, day, 12));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Past years are read below, so no request extends the budget into a new year.
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(lines: (Omit<BudgetLine, 'category'> & { category?: 'dining' | 'groceries' })[], options: { rolloverCarriesOverspend?: boolean } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    const food = await addCategory(em, household, 'Food');
    const categories = { dining: await addCategory(em, household, 'Dining', food), groceries: await addCategory(em, household, 'Groceries', food) };
    const { budget } = await addBudget(em, household, {
      lines: lines.map((line) => ({ accounts: [household.account], ...line, category: categories[line.category ?? 'groceries'] })),
      ...options,
    });
    return { budget, categories, em, household };
  }

  async function month(household: Household, budget: Budget, year: number, monthNumber: number) {
    const response = await http.as(household.appuser).get(`/v1/budget/${budget.budgetKey}/${year}/${monthNumber}`);
    expect(response.status).toBe(200);
    return response.body as { budget: { categories: CategoryRow[] }; rolloverComplete: boolean };
  }
  const row = (body: { budget: { categories: CategoryRow[] } }, name: null | string, parent = 'Food') => {
    const found = body.budget.categories.find((category) => category.child_category_name === name && category.parent_category_name === parent);
    if (!found) throw new Error(`No ${name ?? parent} row in the budget month`);
    return found;
  };
  const spend = (em: EntityManager, household: Household, category: Category, amount: number, date: Date, account?: Account) =>
    addTransaction(em, household, { account, amount, category, date, status: 'BOOKED' });

  it('adds last month\'s surplus to this month\'s available amount', async () => {
    const { budget, categories, em, household } = await setup([{ amount: 100, months: [7, 8], rolloverEnabled: true, year: 2025 }]);
    await spend(em, household, categories.groceries, -60, on(2025, 7));

    const august = row(await month(household, budget, 2025, 8), 'Groceries');

    expect(august).toMatchObject({ category_available: 140, category_budgeted_amount: 100, category_rolled_over: 40, category_rollover_enabled: true });
  });

  it('takes last month\'s overspend off this month', async () => {
    const { budget, categories, em, household } = await setup([{ amount: 100, months: [7, 8], rolloverEnabled: true, year: 2025 }]);
    await spend(em, household, categories.groceries, -125, on(2025, 7));

    const august = row(await month(household, budget, 2025, 8), 'Groceries');

    expect(august).toMatchObject({ category_available: 75, category_rolled_over: -25 });
  });

  it('drops the overspend when the budget does not carry it', async () => {
    const { budget, categories, em, household } = await setup([{ amount: 100, months: [7, 8], rolloverEnabled: true, year: 2025 }], { rolloverCarriesOverspend: false });
    await spend(em, household, categories.groceries, -125, on(2025, 7));

    const august = row(await month(household, budget, 2025, 8), 'Groceries');

    expect(august).toMatchObject({ category_available: 100, category_rolled_over: 0 });
  });

  it('carries exactly what last month showed as spent: net of refunds, split lines and converted partner spending, without transfers', async () => {
    const { budget, categories, em, household } = await setup([{ amount: 300, months: [7, 8], rolloverEnabled: true, year: 2025 }]);
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    const partnerAccount = await addAccount(em, household, { currency: usd, owner: partner });
    await addRate(em, usd, household.currency, 0.5, on(2025, 6, 30));
    for (const template of await budgetRows(em, budget.budgetKey)) template.accounts.add(partnerAccount);
    await em.flush();
    await spend(em, household, categories.groceries, -80, on(2025, 7, 3));
    await spend(em, household, categories.groceries, 20, on(2025, 7, 4));
    await addTransaction(em, household, { amount: -500, category: categories.groceries, date: on(2025, 7, 5), status: 'BOOKED', type: await transferOut(em) });
    const split = await addTransaction(em, household, { account: partnerAccount, amount: -100, appuser: partner, category: categories.groceries, currency: usd, date: on(2025, 7, 6), status: 'BOOKED' });
    await setTransactionSplits(db.em(), { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey }, split.transactionKey, [
      { amount: -60, categoryKey: categories.groceries.categoryKey },
      { amount: -40, categoryKey: categories.dining.categoryKey },
    ]);

    const july = row(await month(household, budget, 2025, 7), 'Groceries');
    const august = row(await month(household, budget, 2025, 8), 'Groceries');

    // 80 - 20 EUR, plus the 60 USD grocery line at 0.5; the transfer is not spending.
    expect(july.category_amount).toBe(90);
    expect(august).toMatchObject({ category_available: 510, category_rolled_over: 300 - july.category_amount });
  });

  it('carries a non-monthly budget by its monthly share, as the month shows it', async () => {
    // 120 a quarter is a plan of 40 a month.
    const { budget, categories, em, household } = await setup([{ amount: 120, months: [7, 8], recurrency: Recurrency.QUARTERLY, rolloverEnabled: true, year: 2025 }]);
    await spend(em, household, categories.groceries, -10, on(2025, 7));

    const august = await month(household, budget, 2025, 8);

    expect(row(august, 'Groceries')).toMatchObject({ category_available: 70, category_rolled_over: 30 });
    expect(row(august, null)).toMatchObject({ category_available: 70, category_rolled_over: 30 });
  });

  it('reflects an edit to an old transaction the next time the month is read', async () => {
    const { budget, categories, em, household } = await setup([{ amount: 100, months: [7, 8], rolloverEnabled: true, year: 2025 }]);
    const purchase = await spend(em, household, categories.groceries, -60, on(2025, 7));
    expect(row(await month(household, budget, 2025, 8), 'Groceries').category_rolled_over).toBe(40);

    purchase.editedSettlementAmount = -90;
    purchase.appuserSettlementAmount = -90;
    await em.flush();

    expect(row(await month(household, budget, 2025, 8), 'Groceries').category_rolled_over).toBe(10);
  });

  it('carries across a run of months and from December into January', async () => {
    const { budget, categories, em, household } = await setup([
      { amount: 100, months: [11, 12], rolloverEnabled: true, year: 2024 },
      { amount: 100, months: [1], rolloverEnabled: true, year: 2025 },
    ]);
    await spend(em, household, categories.groceries, -70, on(2024, 11));
    await spend(em, household, categories.groceries, -50, on(2024, 12));

    const january = row(await month(household, budget, 2025, 1), 'Groceries');

    // November leaves 30; December has 130 and spends 50, leaving 80.
    expect(january).toMatchObject({ category_available: 180, category_rolled_over: 80 });
  });

  it('flags the carried amount when last month has spending it could not convert, and carries what is known', async () => {
    const { budget, categories, em, household } = await setup([{ amount: 100, months: [7, 8, 9], rolloverEnabled: true, year: 2025 }]);
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    const partnerAccount = await addAccount(em, household, { currency: usd, owner: partner });
    for (const template of await budgetRows(em, budget.budgetKey)) template.accounts.add(partnerAccount);
    await em.flush();
    await spend(em, household, categories.groceries, -30, on(2025, 7));
    // No USD to EUR rate is stored: this row cannot be added to July.
    await addTransaction(em, household, { account: partnerAccount, amount: -50, appuser: partner, category: categories.groceries, currency: usd, date: on(2025, 7, 12), status: 'BOOKED' });

    const august = await month(household, budget, 2025, 8);
    const september = await month(household, budget, 2025, 9);

    expect(row(august, 'Groceries')).toMatchObject({ category_rolled_over: 70, category_rollover_incomplete: true });
    expect(row(august, null)).toMatchObject({ category_rollover_incomplete: true });
    expect(august.rolloverComplete).toBe(false);
    expect(row(september, 'Groceries')).toMatchObject({ category_rolled_over: 170, category_rollover_incomplete: true });
  });

  it('does not carry a partner\'s private spending into the other member\'s budget', async () => {
    const { budget, categories, em, household } = await setup([{ amount: 100, months: [7, 8], rolloverEnabled: true, year: 2025 }]);
    const partner = await addPartner(em, household);
    const hidden = await addAccount(em, household, { isPrivate: true, owner: partner });
    for (const template of await budgetRows(em, budget.budgetKey)) template.accounts.add(hidden);
    await em.flush();
    await addTransaction(em, household, { account: hidden, amount: -45, appuser: partner, category: categories.groceries, date: on(2025, 7), status: 'BOOKED' });

    const ownerView = row(await month(household, budget, 2025, 8), 'Groceries');
    const partnerResponse = await http.as(partner).get(`/v1/budget/${budget.budgetKey}/2025/8`);

    expect(ownerView.category_rolled_over).toBe(100);
    expect(row(partnerResponse.body, 'Groceries').category_rolled_over).toBe(55);
  });

  it('adds the subcategories\' carried amounts up on their parent', async () => {
    const { budget, categories, em, household } = await setup([
      { amount: 100, category: 'groceries', months: [7, 8], rolloverEnabled: true, year: 2025 },
      { amount: 50, category: 'dining', months: [7, 8], rolloverEnabled: true, year: 2025 },
    ]);
    await spend(em, household, categories.groceries, -60, on(2025, 7));
    await spend(em, household, categories.dining, -80, on(2025, 7));

    const august = await month(household, budget, 2025, 8);

    expect(row(august, null)).toMatchObject({ category_available: 160, category_budgeted_amount: 150, category_rolled_over: 10, category_rollover_enabled: true });
    expect(august.rolloverComplete).toBe(true);
  });

  describe('turning it on and off', () => {
    it('turns rollover on for a month and the months after it, into later years', async () => {
      const { budget, categories, household } = await setup([
        { amount: 100, rolloverEnabled: false, year: 2025 },
        { amount: 100, months: [1, 2], rolloverEnabled: false, year: 2026 },
      ]);

      const response = await http.as(household.appuser).patch(`/v1/budget/${budget.budgetKey}/2025/10/${categories.groceries.categoryKey}`).send({ rolloverEnabled: true });

      expect(response.status).toBe(200);
      const rows = await budgetRows(db.em(), budget.budgetKey);
      expect(rows.map((stored) => [stored.year, stored.month, stored.rolloverEnabled])).toEqual([
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => [2025, m, false]),
        [2025, 10, true], [2025, 11, true], [2025, 12, true], [2026, 1, true], [2026, 2, true],
      ]);
      // The amount is left as it was.
      expect(rows.every((stored) => stored.amountBudgeted === 100)).toBe(true);
    });

    it('stops the carry from the month it is turned off', async () => {
      const { budget, categories, em, household } = await setup([{ amount: 100, months: [6, 7, 8, 9], rolloverEnabled: true, year: 2025 }]);
      await spend(em, household, categories.groceries, -60, on(2025, 6));

      await http.as(household.appuser).patch(`/v1/budget/${budget.budgetKey}/2025/8/${categories.groceries.categoryKey}`).send({ applyToFollowingMonths: false, rolloverEnabled: false });

      expect(row(await month(household, budget, 2025, 7), 'Groceries').category_rolled_over).toBe(40);
      expect(row(await month(household, budget, 2025, 8), 'Groceries')).toMatchObject({ category_available: 100, category_rolled_over: 0, category_rollover_enabled: false });
      // September starts a new run: August took no part, so it passes nothing on.
      expect(row(await month(household, budget, 2025, 9), 'Groceries').category_rolled_over).toBe(0);
    });

    it('lets a budget stop carrying overspend', async () => {
      const { budget, household } = await setup([{ amount: 100, months: [7], year: 2025 }]);

      const response = await http.as(household.appuser).patch(`/v1/budget/${budget.budgetKey}`).send({ rolloverCarriesOverspend: false });

      expect(response.status).toBe(200);
      const stored = await db.em().findOneOrFail(Budget, { budgetKey: budget.budgetKey }, { filters: false });
      expect(stored).toMatchObject({ name: 'Home', rolloverCarriesOverspend: false });
    });
  });
});

async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number, date: Date) {
  em.create(ExchangeRate, { date, fromCurrency: from, rate, toCurrency: to }, { partial: true });
  await em.flush();
}

async function transferOut(em: EntityManager) {
  const { TransactionType } = await import('@entity/TransactionType');
  return (await em.findOne(TransactionType, { name: 'TRANSFER_OUT' })) ?? em.create(TransactionType, { displayName: 'Transfer out', name: 'TRANSFER_OUT' }, { partial: true });
}
