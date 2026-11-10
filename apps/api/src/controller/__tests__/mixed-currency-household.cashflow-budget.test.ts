import type { EntityManager } from '@mikro-orm/postgresql';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import type { Transaction } from '@entity/Transaction';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getAccountsCashflow } from '../account/cashflow';
import { getBudgetsFull, getBudgetTemplateByYear, getBudgetTemplateByYearAndMonth, getBudgetTemplateByYearUntilMonth } from '../budget';

interface BudgetBody { budget: { categories: { category_amount: number | string; child_category_name: null | string; parent_category_name: string }[]; currencyCode: string }; completeness: Completeness }

interface CashflowBody { cashflow: { amount: number | string; date: string }[]; completeness: Completeness }
interface Completeness { currencyCode: string; isComplete: boolean; unconvertedCurrencies?: string[]; unconvertedTransactions: number }
type Handler = (req: Request, res: Response, next: (error?: unknown) => void) => Promise<unknown>;

async function call<T>(handler: Handler, household: Household, viewer: Appuser, params: Record<string, string> = {}, query: Record<string, string> = {}): Promise<T> {
  let body: unknown;
  let failure: unknown;
  const res = { json: (payload: unknown) => { body = payload; return res; }, status: vi.fn(() => res) } as unknown as Response;
  const req = { body: {}, headers: {}, params, query, tenant: household.tenant, user: viewer } as unknown as Request;
  await handler(req, res, (error) => { failure = error; });
  if (failure) throw failure as Error;
  return body as T;
}

/*
 * A household whose members keep their books in different currencies: the owner in EUR, the
 * partner in USD. A transaction stores its amount in its account owner's currency. The dashboard
 * cash flow is shown in the viewer's currency, and a budget's spending in the budget's currency
 * (the one its budgeted amounts are in), converting each row at the rate of its date. A row with
 * no rate is left out and counted; it is never added at face value.
 *
 * Rates (published 2025-06-30): 1 EUR = 1.25 USD, 1 USD = 0.8 EUR.
 * From 2025-07-20:              1 EUR = 2 USD,    1 USD = 0.5 EUR.
 *
 *   Owner (EUR):   salary +2000 EUR (Jul 2), groceries -100 EUR (Jul 5)
 *   Partner (USD): salary +1100 USD (Jul 3), groceries -220 USD (Jul 6)
 */
describe('a household with members in two currencies: cash flow and budgets', () => {
  const db = useTestDatabase();
  // A past year, so reading a budget does not extend it into a new year.
  const july = (day: number) => new Date(Date.UTC(2025, 6, day, 12));
  const RATE_DATE = new Date('2025-06-30T00:00:00Z');
  const RATE_CHANGE = new Date('2025-07-20T00:00:00Z');

  async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number, date: Date) {
    em.create(ExchangeRate, { date, fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function mixedHousehold(input: { withRates?: boolean } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = household.currency;
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    const partnerAccount = await addAccount(em, household, { currency: usd, name: 'Checking', owner: partner });
    if (input.withRates ?? true) {
      await addRate(em, eur, usd, 1.25, RATE_DATE);
      await addRate(em, usd, eur, 0.8, RATE_DATE);
      await addRate(em, eur, usd, 2, RATE_CHANGE);
      await addRate(em, usd, eur, 0.5, RATE_CHANGE);
    }
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    const salary = await addCategory(em, household, 'Salary');

    await addTransaction(em, household, { amount: 2000, category: salary, date: july(2), status: 'BOOKED' });
    await addTransaction(em, household, { amount: -100, category: groceries, date: july(5), status: 'BOOKED' });
    await addTransaction(em, household, { account: partnerAccount, amount: 1100, appuser: partner, category: salary, currency: usd, date: july(3), status: 'BOOKED' });
    const partnerGroceries: Transaction = await addTransaction(em, household, { account: partnerAccount, amount: -220, appuser: partner, category: groceries, currency: usd, date: july(6), status: 'BOOKED' });

    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: eur, name: 'Home', numAdults: 2, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    for (const month of [6, 7]) {
      const template = em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: groceries, month, year: 2025 }, { partial: true });
      template.accounts.add(household.account, partnerAccount);
    }
    await em.flush();
    return { budget, em, food, groceries, household, partner, partnerAccount, partnerGroceries, usd };
  }

  const julyRow = (body: CashflowBody) => body.cashflow.find((row) => row.date.startsWith('2025-07'));
  const groceriesSpent = (body: BudgetBody) => Number(body.budget.categories.find((row) => row.child_category_name === 'Groceries')?.category_amount);
  const foodSpent = (body: BudgetBody) => Number(body.budget.categories.find((row) => row.child_category_name === null && row.parent_category_name === 'Food')?.category_amount);
  const FROM = { fromDate: '2025-07-01' };

  describe('dashboard cash flow', () => {
    it('converts the partner\'s dollars for the euro owner', async () => {
      const { household } = await mixedHousehold();

      const body = await call<CashflowBody>(getAccountsCashflow as Handler, household, household.appuser, {}, FROM);

      // 2000 - 100 EUR, plus (1100 - 220) USD at 0.8 = 704 EUR.
      expect(Number(julyRow(body)?.amount)).toBe(2604);
      expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
    });

    it('converts the owner\'s euros for the dollar partner', async () => {
      const { household, partner } = await mixedHousehold();

      const body = await call<CashflowBody>(getAccountsCashflow as Handler, household, partner, {}, FROM);

      // (2000 - 100) EUR at 1.25 = 2375 USD, plus 1100 - 220 USD.
      expect(Number(julyRow(body)?.amount)).toBe(3255);
      expect(body.completeness).toMatchObject({ currencyCode: 'USD', isComplete: true });
    });

    it('converts each row at the rate of its own date', async () => {
      const { em, household, partner, partnerAccount, usd } = await mixedHousehold();
      await addTransaction(em, household, { account: partnerAccount, amount: -100, appuser: partner, currency: usd, date: july(22), status: 'BOOKED' });

      const body = await call<CashflowBody>(getAccountsCashflow as Handler, household, household.appuser, {}, FROM);

      // The July 22 row takes the July 20 rate (0.5): -50 EUR, not -80.
      expect(Number(julyRow(body)?.amount)).toBe(2554);
    });

    it('counts the partner\'s rows when no rate converts them, and leaves them out of the total', async () => {
      const { household } = await mixedHousehold({ withRates: false });

      const body = await call<CashflowBody>(getAccountsCashflow as Handler, household, household.appuser, {}, FROM);

      expect(Number(julyRow(body)?.amount)).toBe(1900);
      expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 2 });
    });
  });

  describe('budget totals', () => {
    it('converts the partner\'s spending into the budget\'s currency on the month view', async () => {
      const { budget, household } = await mixedHousehold();

      const body = await call<BudgetBody>(getBudgetTemplateByYearAndMonth as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

      // 100 EUR + 220 USD at 0.8.
      expect(groceriesSpent(body)).toBe(276);
      expect(foodSpent(body)).toBe(276);
      expect(body.budget.currencyCode).toBe('EUR');
      expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
    });

    it('shows the partner the same budget in the budget\'s currency', async () => {
      const { budget, household, partner } = await mixedHousehold();

      const body = await call<BudgetBody>(getBudgetTemplateByYearAndMonth as Handler, household, partner, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

      expect(groceriesSpent(body)).toBe(276);
      expect(body.completeness).toMatchObject({ currencyCode: 'EUR', isComplete: true });
    });

    it('converts each row at the rate of its own date', async () => {
      const { budget, em, groceries, household, partner, partnerAccount, usd } = await mixedHousehold();
      await addTransaction(em, household, { account: partnerAccount, amount: -100, appuser: partner, category: groceries, currency: usd, date: july(22), status: 'BOOKED' });

      const body = await call<BudgetBody>(getBudgetTemplateByYearAndMonth as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

      expect(groceriesSpent(body)).toBe(326);
    });

    it('counts the partner\'s rows when no rate converts them, and leaves them out of the total', async () => {
      const { budget, household } = await mixedHousehold({ withRates: false });

      const body = await call<BudgetBody>(getBudgetTemplateByYearAndMonth as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

      expect(groceriesSpent(body)).toBe(100);
      expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });

    describe('with the partner\'s dollar payment split over two budgeted categories', () => {
      /** The partner's -220 USD split -165 Groceries / -55 Dining (both under Food), each budgeted in July. */
      async function splitHousehold(input: { withRates?: boolean } = {}) {
        const setup = await mixedHousehold(input);
        const { budget, em, food, household, partner, partnerAccount, partnerGroceries } = setup;
        const dining = await addCategory(em, household, 'Dining', food);
        const template = em.create(BudgetTemplateCategory, { amountBudgeted: 200, budgetKey: budget, categoryKey: dining, month: 7, year: 2025 }, { partial: true });
        template.accounts.add(household.account, partnerAccount);
        await em.flush();
        await setTransactionSplits(db.em(), { appuserKey: partner.appuserKey, tenantKey: household.tenant.tenantKey }, partnerGroceries.transactionKey, [
          { amount: -165, categoryKey: setup.groceries.categoryKey },
          { amount: -55, categoryKey: dining.categoryKey },
        ]);
        return setup;
      }
      const diningSpent = (body: BudgetBody) => Number(body.budget.categories.find((row) => row.child_category_name === 'Dining')?.category_amount);

      it('counts each line in its category, converted into the budget\'s currency at the day\'s rate', async () => {
        const { budget, household } = await splitHousehold();

        const body = await call<BudgetBody>(getBudgetTemplateByYearAndMonth as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

        // Groceries: 100 EUR + 165 USD at 0.8; Dining: 55 USD at 0.8. The parent counts the payment once.
        expect(groceriesSpent(body)).toBe(232);
        expect(diningSpent(body)).toBe(44);
        expect(foodSpent(body)).toBe(276);
        expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
      });

      it('converts the lines on the yearly view', async () => {
        const { budget, household } = await splitHousehold();

        const year = await call<BudgetBody>(getBudgetTemplateByYear as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), year: '2025' });

        expect(groceriesSpent(year)).toBe(232);
        expect(diningSpent(year)).toBe(44);
      });

      it('leaves every line out with no rate, and counts the split payment once', async () => {
        const { budget, household } = await splitHousehold({ withRates: false });

        const body = await call<BudgetBody>(getBudgetTemplateByYearAndMonth as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

        expect(groceriesSpent(body)).toBe(100);
        expect(diningSpent(body)).toBe(0);
        expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
      });
    });

    it('converts on the yearly and year-until-month views', async () => {
      const { budget, household } = await mixedHousehold();

      const year = await call<BudgetBody>(getBudgetTemplateByYear as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), year: '2025' });
      const untilJuly = await call<BudgetBody>(getBudgetTemplateByYearUntilMonth as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

      expect(groceriesSpent(year)).toBe(276);
      expect(groceriesSpent(untilJuly)).toBe(276);
      expect(year.completeness).toMatchObject({ isComplete: true, unconvertedTransactions: 0 });
    });

    it('counts unconverted rows on the yearly view', async () => {
      const { budget, household } = await mixedHousehold({ withRates: false });

      const year = await call<BudgetBody>(getBudgetTemplateByYear as Handler, household, household.appuser, { budgetKey: String(budget.budgetKey), year: '2025' });

      expect(groceriesSpent(year)).toBe(100);
      expect(year.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });
  });

  describe('home budget summary', () => {
    it('converts the partner\'s spending into the budget\'s currency', async () => {
      vi.useFakeTimers({ now: july(25), toFake: ['Date'] });
      try {
        const { household } = await mixedHousehold();

        const body = await call<{ budgets: { categories: BudgetBody['budget']['categories']; completeness: Completeness }[] }>(getBudgetsFull as Handler, household, household.appuser);

        const [budget] = body.budgets;
        expect(budget && groceriesSpent({ budget: { categories: budget.categories, currencyCode: 'EUR' }, completeness: budget.completeness })).toBe(276);
        expect(budget?.completeness).toMatchObject({ currencyCode: 'EUR', isComplete: true });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
