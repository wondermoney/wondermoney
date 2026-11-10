import type { EntityManager } from '@mikro-orm/postgresql';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { getAccountsCashflow } from '@controller/account/cashflow';
import { getCategorySpending } from '@controller/account/transactions';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';
import { getBudgetSpending } from '@service/budget/spending';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { listFiltersForReport } from '@service/reports/report-filters';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { listTransactions } from '@service/transaction/transaction-list.service';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';
import type { TransactionFilterInput } from '@service/transaction/transaction-total.service';
import { roundDisplay } from '@utils/money';
import { savingsRateNumber } from '@utils/savings-rate';
import { reportFiltersSchema } from '@validators/reports';

/*
 * Every total the household sees for a period is the sum of the transactions the list shows for the
 * same filters. The household is built to make the rules that decide "the transactions in this
 * period" disagree if any surface applies them differently:
 *
 * - a split payment with one line in "Investments and savings" (not spending), and a payment wholly
 *   in it;
 * - a matched transfer between two own accounts;
 * - a hidden row, a pending row, an expired row, a legacy row with no status, a row with no type;
 * - the viewer's own private account (visible), the partner's private account (not), a deleted
 *   account (not);
 * - the partner keeps dollars: one dollar expense, converted at the day's rate, and one expense
 *   settled in euros, which reads as its euro amount for a euro viewer;
 * - a row with no converted amount, left out of every total and counted as incomplete;
 * - bank bookings (a date with no time) on the first day of the month and on the first day of the
 *   next one, and card payments with a time near midnight, for a viewer west of UTC.
 */
describe('report and dashboard totals equal the transaction list total', () => {
  const db = useTestDatabase();
  const TIME_ZONE = 'America/New_York';
  /** July 2026 on the viewer's calendar (UTC-4). */
  const JULY = { fromDate: '2026-07-01T04:00:00.000Z', toDate: '2026-08-01T03:59:59.999Z' };
  /** July 2026 on the UTC calendar, the budget's month. */
  const JULY_UTC = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T23:59:59.999Z' };
  const day = (date: number, hour = 12) => new Date(Date.UTC(2026, 6, date, hour));

  interface Scenario {
    budgetAccounts: Account[];
    groceries: Category;
    household: Household;
    templateKeys: number[];
    viewer: Appuser;
  }

  let scenario: Scenario;

  async function type(em: EntityManager, name: string): Promise<TransactionType> {
    const existing = await em.findOne(TransactionType, { name });
    if (existing) return existing;
    const created = em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
    return created;
  }

  async function rate(em: EntityManager, from: Currency, to: Currency, value: number) {
    em.create(ExchangeRate, { date: new Date('2026-06-01T00:00:00Z'), fromCurrency: from, rate: value, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function patch(transaction: Transaction, values: Partial<Transaction>) {
    const em = db.em();
    const stored = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    Object.assign(stored, values);
    await em.flush();
  }

  async function seed(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = household.currency;
    const usd = await currencyFor(em, 'USD');
    const gbp = await currencyFor(em, 'GBP');
    await rate(em, usd, eur, 0.9);
    await rate(em, eur, usd, 1.1);
    const partner = await addPartner(em, household, { currency: usd });

    // Budgets count child categories.
    const food = await addCategory(em, household, 'Food');
    const groceries = await addCategory(em, household, 'Groceries', food);
    const dining = await addCategory(em, household, 'Dining');
    const savings = await addCategory(em, household, 'Savings');
    savings.countsAsSpending = false;
    await em.flush();
    const transferOut = await type(em, 'TRANSFER_OUT');
    const transferIn = await type(em, 'TRANSFER_IN');

    const ownerPrivate = await addAccount(em, household, { isPrivate: true, name: 'Owner savings' });
    const partnerShared = await addAccount(em, household, { currency: usd, name: 'Partner checking', owner: partner });
    const partnerPrivate = await addAccount(em, household, { currency: usd, isPrivate: true, name: 'Partner private', owner: partner });
    const deleted = await addAccount(em, household, { name: 'Closed and deleted' });

    const add = (input: Parameters<typeof addTransaction>[2]) => addTransaction(em, household, input);

    // Bank bookings: 1 July counts in July, 1 August does not, wherever the viewer is.
    await add({ amount: 2000, date: new Date('2026-07-01T00:00:00Z'), status: 'BOOKED' });
    await add({ amount: -100, category: groceries, date: new Date('2026-08-01T00:00:00Z'), status: 'BOOKED' });
    // Card payments near midnight: 23:30 on 31 July in New York (August in UTC), 22:00 on 30 June (July in UTC).
    await add({ amount: -40, category: groceries, date: new Date('2026-08-01T03:30:00Z'), status: 'BOOKED' });
    await add({ amount: -7, category: groceries, date: new Date('2026-07-01T02:00:00Z'), status: 'BOOKED' });

    // A split payment: 70 groceries, 30 into savings (not spending). And a payment wholly into savings.
    const split = await add({ amount: -100, category: groceries, date: day(10), status: 'BOOKED' });
    await setTransactionSplits(db.em(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, split.transactionKey, [
      { amount: -70, categoryKey: groceries.categoryKey },
      { amount: -30, categoryKey: savings.categoryKey },
    ]);
    await add({ amount: -200, category: savings, date: day(11), status: 'BOOKED' });

    // A transfer between own accounts.
    await add({ amount: -300, date: day(12), status: 'BOOKED', type: transferOut });
    await add({ account: ownerPrivate, amount: 300, date: day(12), status: 'BOOKED', type: transferIn });

    await add({ amount: -25, category: groceries, date: day(13), hidden: true, status: 'BOOKED' });
    await add({ amount: -15, category: groceries, date: day(14), status: 'PENDING' });
    await add({ amount: -999, category: groceries, date: day(14), status: 'EXPIRED' });
    await add({ amount: -12, category: dining, date: day(15), status: null });
    const untyped = await add({ amount: -18, category: dining, date: day(16), status: 'BOOKED' });
    await patch(untyped, { transactionTypeKey: undefined });
    // A refund: money in, in a spending category.
    await add({ amount: 30, category: groceries, date: day(17), status: 'BOOKED' });
    // No rate converted this pound payment when it was stored.
    const unconverted = await add({ amount: -10, category: dining, date: day(18), status: 'BOOKED' });
    await patch(unconverted, { appuserSettlementAmount: undefined, fxStatus: FxStatus.MISSING, originalCurrencyKey: gbp, settlementCurrencyKey: gbp });

    // The viewer's own private account counts for the viewer.
    await add({ account: ownerPrivate, amount: -5, category: dining, date: day(19), status: 'BOOKED' });

    // A transfer across currencies, paired as transfer matching pairs it: 110 EUR leave the owner's
    // account and arrive as 120 USD (108 EUR at 0.9) on the partner's.
    const sent = await add({ amount: -110, date: day(23), status: 'BOOKED', type: transferOut });
    const received = await add({ account: partnerShared, amount: 120, appuser: partner, currency: usd, date: day(24), status: 'BOOKED', type: transferIn });
    await patch(sent, { transferCounterpartKey: received, transferExchangeRate: 120 / 110 });
    await patch(received, { transferCounterpartKey: sent, transferExchangeRate: 120 / 110 });

    // The partner's dollar spending: 20 USD (18 EUR at 0.9), and 10 EUR stored as 11 USD.
    await add({ account: partnerShared, amount: -20, appuser: partner, category: dining, currency: usd, date: day(20), status: 'BOOKED' });
    const settledInEuros = await add({ account: partnerShared, amount: -11, appuser: partner, category: groceries, currency: usd, date: day(21), status: 'BOOKED' });
    await patch(settledInEuros, { settlementAmount: -10, settlementCurrencyKey: eur });

    // Never visible to the owner: the partner's private account, and a deleted account.
    await add({ account: partnerPrivate, amount: -50, appuser: partner, category: groceries, currency: usd, date: day(22), status: 'BOOKED' });
    await add({ account: deleted, amount: -60, category: groceries, date: day(22), status: 'BOOKED' });
    // Deleting an account leaves its transactions in place.
    deleted.deletedAt = new Date('2026-07-25T00:00:00Z');
    await em.flush();

    // Another household's spending never counts.
    const other = await seedHousehold(em);
    await addTransaction(em, other, { amount: -1000, date: day(10), status: 'BOOKED' });

    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: eur, name: 'Home', numAdults: 2, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: groceries, month: 7, year: 2026 }, { partial: true });
    await em.flush();

    return { budgetAccounts: [household.account, ownerPrivate, partnerShared], groceries, household, templateKeys: [template.budgetTemplateCategoryKey], viewer: household.appuser };
  }

  beforeEach(async () => {
    scenario = await seed();
  });

  async function list(filters: TransactionFilterInput) {
    const page = await listTransactions({ filters, limit: 500, scope: 'all-accounts', tenantKey: scenario.household.tenant.tenantKey, viewerAppuserKey: scenario.viewer.appuserKey });
    if (page.totalAmount === null || page.completeness === null || page.moneyIn === null || page.moneyOut === null) throw new Error('The first page carries the total');
    return { amount: roundDisplay(page.totalAmount), completeness: page.completeness, count: page.total, moneyIn: roundDisplay(page.moneyIn), moneyOut: roundDisplay(page.moneyOut), rows: page.transactions };
  }

  const reportFilters = (extra: Record<string, unknown> = {}) => reportFiltersSchema.parse({ ...JULY, timezone: TIME_ZONE, ...extra });
  const reportInput = (extra: Record<string, unknown> = {}) => ({ filters: reportFilters(extra), tenant: scenario.household.tenant, user: scenario.viewer });

  async function callHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>, query: Record<string, string>): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    const res = { json: (payload: Record<string, unknown>) => { body = payload; return res; }, status: () => res } as unknown as Response;
    await handler({ body: {}, headers: {}, params: {}, query, tenant: scenario.household.tenant, user: scenario.viewer } as unknown as Request, res, () => undefined);
    return body;
  }

  describe('spending by category', () => {
    it('totals the money out the list shows for the report\'s filters', async () => {
      const report = await getSpendingByCategoryReport(reportInput());
      const listed = await list({ ...listFiltersForReport(reportFilters()), direction: 'out' });

      const reportTotal = roundDisplay(report.data.reduce((sum, row) => sum + row.totalAmount, 0));
      // 40 (23:30 on 31 July), 70 (the split's grocery line), 18 (no type), 5 (own private account),
      // 18 (20 USD), 10 (settled in euros).
      expect(reportTotal).toBe(161);
      expect(listed.amount).toBe(-reportTotal);
      expect(listed.completeness.unconvertedTransactions).toBe(report.completeness.unconvertedTransactions);
      expect(report.completeness.unconvertedTransactions).toBe(1);
    });

    it('counts only the filtered category\'s lines, like the list', async () => {
      const extra = { categoryKeys: [String(scenario.groceries.categoryKey)] };
      const report = await getSpendingByCategoryReport(reportInput(extra));
      const listed = await list({ ...listFiltersForReport(reportFilters(extra)), direction: 'out' });

      expect(report.data.map((row) => [row.name, row.totalAmount])).toEqual([['Groceries', 120]]);
      expect(listed.amount).toBe(-120);
    });
  });

  describe('cash flow report', () => {
    it('has the month\'s income and expenses of the list for the report\'s filters', async () => {
      const report = await getCashflowReport(reportInput());
      const money = async (direction: 'in' | 'out') => (await list({ ...listFiltersForReport(reportFilters()), direction })).amount;

      expect(report.data).toEqual([expect.objectContaining({ expenses: 161, income: 2030, month: expect.stringMatching(/^2026-07/) })]);
      expect(await money('in')).toBe(2030);
      expect(await money('out')).toBe(-161);
    });

    it('agrees with the list with pending rows and transfers included', async () => {
      const extra = { includePending: 'true', includeTransfers: 'true' };
      const report = await getCashflowReport(reportInput(extra));
      const money = async (direction: 'in' | 'out') => (await list({ ...listFiltersForReport(reportFilters(extra)), direction })).amount;

      // Transfers now count: 300 each way between own accounts, and 110 EUR out, 108 EUR in across
      // currencies; pending adds 15 out.
      expect(report.data).toEqual([expect.objectContaining({ expenses: 586, income: 2438 })]);
      expect(await money('in')).toBe(2438);
      expect(await money('out')).toBe(-586);
    });

    it('has the money in and out the list sums with its total', async () => {
      const report = await getCashflowReport(reportInput());
      const listed = await list(listFiltersForReport(reportFilters()));

      expect(listed.moneyIn).toBe(report.data[0]?.income);
      expect(listed.moneyOut).toBe(report.data[0]?.expenses);
      expect(listed.amount).toBe(report.data[0]?.net);
    });
  });

  describe('the transactions page', () => {
    it('money in and out are the list\'s, in the viewer\'s currency, transfers included', async () => {
      const listed = await list({ fromDate: new Date(JULY.fromDate), timeZone: TIME_ZONE, toDate: new Date(JULY.toDate) });

      // Every listed row: 2000 + 300 + 30 + 108 (120 USD) in; the rest out, the savings rows whole.
      expect(listed.moneyIn).toBe(2438);
      expect(listed.moneyOut).toBe(40 + 100 + 200 + 300 + 15 + 12 + 18 + 5 + 18 + 10 + 110);
      expect(listed.amount).toBe(roundDisplay(listed.moneyIn - listed.moneyOut));
    });
  });

  describe('the dashboard', () => {
    /** The rows the dashboard's month figures count: pending too, no transfers, spending lines only. */
    const DASHBOARD: TransactionFilterInput = { excludeNonSpending: true, excludeTransfers: true, fromDate: new Date(JULY.fromDate), timeZone: TIME_ZONE, toDate: new Date(JULY.toDate) };

    it('cash flow for the month is the list\'s total', async () => {
      const body = await callHandler(getAccountsCashflow, { fromDate: JULY.fromDate, timezone: TIME_ZONE });
      const listed = await list(DASHBOARD);

      const july = (body['cashflow'] as { amount: number; date: string; expenses: number; income: number; savingsRate: null | number }[]).find((month) => month.date.startsWith('2026-07'));
      // 2000 + 30 in; 40 + 70 + 15 + 12 + 18 + 5 + 18 + 10 out.
      expect(listed.amount).toBe(1842);
      expect(july?.amount).toBe(listed.amount);
      expect(july?.income).toBe(listed.moneyIn);
      expect(july?.expenses).toBe(listed.moneyOut);
      expect((body['completeness'] as { unconvertedTransactions: number }).unconvertedTransactions).toBe(listed.completeness.unconvertedTransactions);
    });

    it('states the savings rate the shared helper defines, from its own income and expenses', async () => {
      const body = await callHandler(getAccountsCashflow, { fromDate: JULY.fromDate, timezone: TIME_ZONE });

      const july = (body['cashflow'] as { date: string; expenses: number; income: number; savingsRate: null | number }[]).find((month) => month.date.startsWith('2026-07'));
      if (!july) throw new Error('The July cash-flow row is missing');

      expect(july.savingsRate).toBe(savingsRateNumber(july.income, july.expenses));
    });

    it('category spending is the list\'s money out', async () => {
      const body = await callHandler(getCategorySpending, { fromDate: JULY.fromDate, timezone: TIME_ZONE, toDate: JULY.toDate });
      const listed = await list({ ...DASHBOARD, direction: 'out' });

      const total = roundDisplay((body['categorySpending'] as { amount: number }[]).reduce((sum, row) => sum + row.amount, 0));
      expect(total).toBe(188);
      expect(listed.amount).toBe(-total);
      expect((body['completeness'] as { unconvertedTransactions: number }).unconvertedTransactions).toBe(listed.completeness.unconvertedTransactions);
    });
  });

  it('budget spending is the list\'s net spending in the category for the budget\'s month and accounts', async () => {
    const { categories, completeness } = await getBudgetSpending({
      accountKeys: scenario.budgetAccounts.map((account) => account.accountKey),
      currency: { code: 'EUR', currencyKey: scenario.household.currency.currencyKey },
      period: 'monthly',
      templateKeys: scenario.templateKeys,
      tenantKey: scenario.household.tenant.tenantKey,
      viewerAppuserKey: scenario.viewer.appuserKey,
    });
    // Budget months are UTC calendar months.
    const listed = await list({
      accountKeys: scenario.budgetAccounts.map((account) => account.accountKey),
      categoryKeys: { includeUncategorized: false, keys: [scenario.groceries.categoryKey] },
      excludeNonSpending: true,
      excludeTransfers: true,
      fromDate: new Date(JULY_UTC.fromDate),
      timeZone: 'UTC',
      toDate: new Date(JULY_UTC.toDate),
    });

    const groceries = categories.find((row) => row.child_category_name === 'Groceries');
    // 7 (22:00 on 30 June in New York, July in UTC) + 70 + 15 (pending) + 10 (settled in euros) - 30 (refund).
    expect(listed.amount).toBe(-72);
    expect(Number(groceries?.category_amount)).toBe(72);
    expect(completeness.unconvertedTransactions).toBe(listed.completeness.unconvertedTransactions);
  });

  it('the list never shows another member\'s private rows, a deleted account\'s, or another household\'s', async () => {
    const listed = await list({ fromDate: new Date(JULY.fromDate), includeHidden: true, timeZone: TIME_ZONE, toDate: new Date(JULY.toDate) });

    expect(listed.rows.map((row) => row.settlementAmount)).not.toContain(-50);
    expect(listed.rows.map((row) => row.settlementAmount)).not.toContain(-60);
    expect(listed.rows.map((row) => row.settlementAmount)).not.toContain(-1000);
    expect(listed.count).toBe(listed.rows.length);
  });
});
