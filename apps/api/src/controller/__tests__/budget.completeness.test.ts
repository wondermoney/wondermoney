import type { EntityManager } from '@mikro-orm/postgresql';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addAccount, addCategory, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import { FxStatus, Transaction } from '@entity/Transaction';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getBudgetTemplateByYear, getBudgetTemplateByYearAndMonth } from '../budget';

type Handler = (req: Request, res: Response, next: (error?: unknown) => void) => Promise<unknown>;

async function call(handler: Handler, household: Household, params: Record<string, string>) {
  let body: unknown;
  let failure: unknown;
  const res = { json: (payload: unknown) => { body = payload; return res; }, status: vi.fn(() => res) } as unknown as Response;
  const req = { body: {}, headers: {}, params, query: {}, tenant: household.tenant, user: household.appuser } as unknown as Request;
  await handler(req, res, (error) => { failure = error; });
  if (failure) throw failure as Error;
  return body as { budget: { categories: { category_amount: number; child_category_name: null | string }[] }; completeness: unknown };
}

/*
 * A budget's spending is in the household's currency. A row with no converted amount (no rate for
 * its currency) cannot be added to it; the budget says how many were left out and in which
 * currencies, instead of showing a total that looks complete.
 */
describe('budget month totals and unconverted rows', () => {
  const db = useTestDatabase();
  // A past year, so reading it does not extend the budget into a new year.
  const JULY = new Date('2025-07-15T12:00:00Z');

  async function seedBudget() {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries', await addCategory(em, household, 'Food'));
    const usdAccount = await addAccount(em, household, { balance: 0, currency: await currencyFor(em, 'USD'), name: 'Dollars' });
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: groceries, month: 7, year: 2025 }, { partial: true });
    template.accounts.add(household.account, usdAccount);
    await em.flush();
    return { budget, em, groceries, household, usdAccount };
  }

  async function addUnconverted(em: EntityManager, household: Household, input: { account: Account; amount: number; category: Category; date: Date; hidden?: boolean }) {
    const row = em.create(Transaction, {
      accountKey: input.account,
      appuserCurrencyKey: household.currency,
      appuserKey: household.appuser,
      appuserSettlementAmount: null,
      fxStatus: FxStatus.MISSING,
      hidden: input.hidden ?? false,
      settlementAmount: input.amount,
      settlementCurrencyKey: input.account.currencyKey,
      tenantKey: household.tenant,
      transactionDate: input.date,
      transactionStatusKey: household.statuses.BOOKED,
      transactionTypeKey: household.types.cardPayment,
    }, { partial: true });
    em.create(AppuserTransactionCategory, { appuserKey: household.appuser, categoryKey: input.category, source: Source.USER, transactionKey: row }, { partial: true });
    await em.flush();
    return row;
  }

  const groceriesSpent = (body: Awaited<ReturnType<typeof call>>) => body.budget.categories.find((row) => row.child_category_name === 'Groceries')?.category_amount;

  it('counts a row with no converted amount instead of dropping it silently', async () => {
    const { budget, em, groceries, household, usdAccount } = await seedBudget();
    await addTransaction(em, household, { amount: -40, category: groceries, date: JULY, status: 'BOOKED' });
    await addUnconverted(em, household, { account: usdAccount, amount: -25, category: groceries, date: JULY });

    const body = await call(getBudgetTemplateByYearAndMonth as Handler, household, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

    expect(groceriesSpent(body)).toBe(40);
    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('is complete when every row in the month was converted', async () => {
    const { budget, em, groceries, household, usdAccount } = await seedBudget();
    await addTransaction(em, household, { amount: -40, category: groceries, date: JULY, status: 'BOOKED' });
    // Outside the month, or hidden: not part of this budget month either way.
    await addUnconverted(em, household, { account: usdAccount, amount: -25, category: groceries, date: new Date('2025-08-02T12:00:00Z') });
    await addUnconverted(em, household, { account: usdAccount, amount: -25, category: groceries, date: JULY, hidden: true });

    const body = await call(getBudgetTemplateByYearAndMonth as Handler, household, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
  });

  it('leaves out rows on accounts the budget does not track', async () => {
    const { budget, em, groceries, household } = await seedBudget();
    const untracked = await addAccount(em, household, { balance: 0, currency: await currencyFor(em, 'GBP'), name: 'Pounds' });
    await addUnconverted(em, household, { account: untracked, amount: -25, category: groceries, date: JULY });

    const body = await call(getBudgetTemplateByYearAndMonth as Handler, household, { budgetKey: String(budget.budgetKey), month: '7', year: '2025' });

    expect(body.completeness).toMatchObject({ isComplete: true, unconvertedTransactions: 0 });
  });

  it('reports the unconverted rows of the whole year on the yearly view', async () => {
    const { budget, em, groceries, household, usdAccount } = await seedBudget();
    await addUnconverted(em, household, { account: usdAccount, amount: -25, category: groceries, date: JULY });

    const body = await call(getBudgetTemplateByYear as Handler, household, { budgetKey: String(budget.budgetKey), year: '2025' });

    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });
});
