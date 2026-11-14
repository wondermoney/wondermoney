import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { getAccountsCashflow } from '@controller/account/cashflow';
import { getCategorySpending } from '@controller/account/transactions';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Category } from '@entity/Category';
import { TransactionType } from '@entity/TransactionType';
import { AssistantToolsService } from '@service/assistant/assistant-tools.service';
import { classifyTransactions, createDiagnostics } from '@service/budget/aggregation-classifier';
import { getBudgetSpending } from '@service/budget/spending';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { getBudgetVsActualReport } from '@service/reports/budgetVsActual.service';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { getSankeyReport } from '@service/reports/sankey.service';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { setCategoryCountsAsSpending } from '@service/transaction/category-spending';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * Money moved to a broker or a savings pot is not spending. A category whose "counts as spending"
 * flag is off (or whose parent's is) is left out of every spending total: budgets, every report,
 * the dashboard and the monthly emails. A split leaves out only its lines in such a category, and a
 * row typed as a transfer (matched, or marked by the user) is left out whole.
 *
 * The household: 500 in, 40 on groceries, 200 to the broker (Investments and savings > Broker), one
 * card payment of 100 split 70 to the broker and 30 to groceries, a matched 150 transfer between
 * two own accounts, and a 300 payment to a portfolio the user marked as a transfer. Only the 70 of
 * groceries is spending.
 */
describe('categories that do not count as spending', () => {
  const db = useTestDatabase();
  const JULY_10 = new Date('2026-07-10T12:00:00Z');
  const RANGE = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };

  interface Scenario {
    accountKeys: number[];
    broker: Category;
    groceries: Category;
    household: Household;
    templateKeys: number[];
  }

  async function scenario(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const type = async (name: string) => (await em.findOne(TransactionType, { name })) ?? em.create(TransactionType, { displayName: name, name }, { partial: true });
    const transferOut = await type('TRANSFER_OUT');
    const transferIn = await type('TRANSFER_IN');
    await em.flush();

    const shopping = await addCategory(em, household, 'Shopping');
    const groceries = await addCategory(em, household, 'Groceries', shopping);
    const investments = await addCategory(em, household, 'Investments and savings');
    // Off on the parent only: the child inherits it.
    investments.countsAsSpending = false;
    const broker = await addCategory(em, household, 'Broker', investments);
    // The monthly emails count a member's own categories.
    for (const category of [shopping, groceries, investments, broker]) category.appuserKey = household.appuser;
    await em.flush();

    const savings = await addAccount(em, household, { name: 'Savings' });
    await addTransaction(em, household, { amount: 500, date: JULY_10, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -40, category: groceries, date: JULY_10, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -200, category: broker, date: JULY_10, status: 'BOOKED' });
    const card = await addTransaction(em, household, { amount: -100, category: groceries, date: JULY_10, status: 'BOOKED' });
    await setTransactionSplits(db.em(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, card.transactionKey, [
      { amount: -70, categoryKey: broker.categoryKey },
      { amount: -30, categoryKey: groceries.categoryKey },
    ]);
    // A matched pair between two own accounts, categorized or not.
    await addTransaction(em, household, { amount: -150, category: groceries, date: JULY_10, status: 'BOOKED', type: transferOut });
    await addTransaction(em, household, { account: savings, amount: 150, date: JULY_10, status: 'BOOKED', type: transferIn });
    // A payment to a portfolio the user marked as a transfer: it has no counterpart row.
    await addTransaction(em, household, { amount: -300, category: groceries, date: JULY_10, status: 'BOOKED', type: transferOut });

    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const templates = [groceries, broker].map((category) => em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: category, month: 7, year: 2026 }, { partial: true }));
    await em.flush();
    return { accountKeys: [household.account.accountKey, savings.accountKey], broker, groceries, household, templateKeys: templates.map((template) => template.budgetTemplateCategoryKey) };
  }

  const reportInput = (s: Scenario) => ({ filters: reportFiltersSchema.parse(RANGE), tenant: s.household.tenant, user: s.household.appuser });

  async function callHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>, s: Scenario, query: Record<string, string>): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    const res = { json: (payload: Record<string, unknown>) => { body = payload; return res; }, status: () => res } as unknown as Response;
    await handler({ body: {}, headers: {}, params: {}, query, tenant: s.household.tenant, user: s.household.appuser } as unknown as Request, res, () => undefined);
    return body;
  }

  it('in budget spending', async () => {
    const s = await scenario();
    const { categories } = await getBudgetSpending({ accountKeys: s.accountKeys, currency: { code: 'EUR', currencyKey: s.household.currency.currencyKey }, period: 'monthly', periodStartDay: 1, templateKeys: s.templateKeys, tenantKey: s.household.tenant.tenantKey, viewerAppuserKey: s.household.appuser.appuserKey });

    expect(Object.fromEntries(categories.filter((row) => row.child_category_name).map((row) => [row.child_category_name, row.category_amount]))).toEqual({ Broker: 0, Groceries: 70 });
  });

  it('in spending by category', async () => {
    const report = await getSpendingByCategoryReport(reportInput(await scenario()));

    expect(report.data.map((row) => [row.name, row.totalAmount, row.transactionCount])).toEqual([['Groceries', 70, 2]]);
  });

  it('in budget vs actual', async () => {
    const report = await getBudgetVsActualReport(reportInput(await scenario()));

    expect(Object.fromEntries(report.data.map((row) => [row.name, row.actual]))).toMatchObject({ Groceries: 70 });
    expect(report.data.find((row) => row.name === 'Broker')?.actual ?? 0).toBe(0);
  });

  it('in the cash flow report', async () => {
    const report = await getCashflowReport(reportInput(await scenario()));

    expect(report.data).toEqual([expect.objectContaining({ expenses: 70, income: 500 })]);
  });

  it('in the sankey report', async () => {
    const report = await getSankeyReport(reportInput(await scenario()));

    expect(report.data.nodes.filter((node) => node.kind === 'expense').map((node) => [node.label, node.value])).toEqual([['Groceries', 70]]);
  });

  it('in the dashboard\'s category spending', async () => {
    const body = await callHandler(getCategorySpending, await scenario(), { fromDate: RANGE.fromDate, toDate: RANGE.toDate });

    const rows = body['categorySpending'] as { amount: number; childCategories: { amount: number; name: string }[]; name: string; numTransactions: number }[];
    expect(rows.map((row) => [row.name, row.amount, row.numTransactions, row.childCategories.map((child) => [child.name, child.amount])])).toEqual([['Shopping', 70, 2, [['Groceries', 70]]]]);
  });

  it('in the dashboard\'s cash flow', async () => {
    const body = await callHandler(getAccountsCashflow, await scenario(), { fromDate: RANGE.fromDate });

    // 500 in, 70 out: the broker lines and both transfers are left out.
    expect(body['cashflow']).toEqual([expect.objectContaining({ amount: 430 })]);
  });

  it('in the monthly email and budget alert aggregation', async () => {
    const s = await scenario();
    const rows = await new MikroOrmTenantAggregationRepository(db.em()).loadTransactions(s.household.appuser.appuserKey, s.household.tenant.tenantKey, { end: new Date('2026-08-01T00:00:00Z'), start: new Date('2026-07-01T00:00:00Z') });
    const byCategory = new Map<string, number>();
    for (const line of classifyTransactions(rows, s.household.appuser.appuserKey, s.household.tenant.tenantKey, createDiagnostics())) {
      byCategory.set(line.categoryName, Number(line.amount.plus(byCategory.get(line.categoryName) ?? 0).toFixed(4)));
    }

    expect(Object.fromEntries(byCategory)).toEqual({ Groceries: 70 });
  });

  it('in the assistant\'s spending by category', async () => {
    const s = await scenario();
    const tools = AssistantToolsService.createTools({ appuserKey: s.household.appuser.appuserKey, consentVersion: 1, conversationId: 'c-1', currency: 'EUR', tenantKey: s.household.tenant.tenantKey }) as unknown as Record<string, { execute: (input: unknown, options: unknown) => Promise<{ data: { categories: { amount: number; category: string }[] } }> }>;
    const result = await tools['get_spending_by_category']!.execute({ period: 'last_12_months' }, {});

    expect(result.data.categories.map((row) => [row.category, Number(row.amount.toFixed(4))])).toEqual([['Groceries', 70]]);
  });

  it('counts a category again once its flag is back on', async () => {
    const s = await scenario();
    const em = db.em();
    const broker = await em.findOneOrFail(Category, { categoryKey: s.broker.categoryKey }, { populate: ['parentCategory'] });
    broker.parentCategory!.countsAsSpending = true;
    await em.flush();

    const report = await getSpendingByCategoryReport(reportInput(s));
    expect(Object.fromEntries(report.data.map((row) => [row.name, row.totalAmount]))).toEqual({ Broker: 270, Groceries: 70 });
  });
});

/*
 * A household can switch the built-in categories too: "Investments and savings" back on, Groceries
 * off. The choice is the household's own: the same built-in categories keep their defaults for
 * every other household, in every total.
 *
 * Each household: 500 in, 40 on groceries (Food > Groceries), 200 to savings (Investments and
 * savings > Savings), all on built-in categories. Ours switches Investments and savings on and Groceries off.
 */
describe('a household\'s choice for a built-in category', () => {
  const db = useTestDatabase();
  const JULY_10 = new Date('2026-07-10T12:00:00Z');
  const RANGE = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };

  async function scenario() {
    const em = db.em();
    const system = (name: string, countsAsSpending: boolean, parentCategory?: Category) =>
      em.create(Category, { bgColor: '#000', countsAsSpending, isSystemCategory: true, name, parentCategory, textColor: '#fff' }, { partial: true });
    const investments = system('INVESTMENTS_AND_SAVINGS', false);
    const savings = system('SAVINGS', false, investments);
    const groceries = system('GROCERIES', true, system('FOOD', true));
    await em.flush();

    const household = async () => {
      const h = await seedHousehold(em);
      await addTransaction(em, h, { amount: 500, date: JULY_10, status: 'BOOKED' });
      await addTransaction(em, h, { amount: -40, category: groceries, date: JULY_10, status: 'BOOKED' });
      await addTransaction(em, h, { amount: -200, category: savings, date: JULY_10, status: 'BOOKED' });
      const budget = em.create(Budget, { appuserKey: h.appuser, currencyKey: h.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: h.tenant }, { partial: true });
      const templates = [groceries, savings].map((category) => em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: category, month: 7, year: 2026 }, { partial: true }));
      await em.flush();
      return { household: h, templateKeys: templates.map((template) => template.budgetTemplateCategoryKey) };
    };
    const ours = await household();
    const theirs = await household();
    await setCategoryCountsAsSpending(db.em(), ours.household.tenant.tenantKey, investments.categoryKey, true);
    await setCategoryCountsAsSpending(db.em(), ours.household.tenant.tenantKey, groceries.categoryKey, false);
    return { ours, theirs };
  }

  type Side = Awaited<ReturnType<typeof scenario>>['ours'];

  it('in spending by category', async () => {
    const { ours, theirs } = await scenario();
    const report = async ({ household }: Side) => (await getSpendingByCategoryReport({ filters: reportFiltersSchema.parse(RANGE), tenant: household.tenant, user: household.appuser })).data.map((row) => [row.name, row.totalAmount]);

    expect(await report(ours)).toEqual([['SAVINGS', 200]]);
    expect(await report(theirs)).toEqual([['GROCERIES', 40]]);
  });

  it('in budget spending', async () => {
    const { ours, theirs } = await scenario();
    const spending = async ({ household, templateKeys }: Side) => {
      const { categories } = await getBudgetSpending({ accountKeys: [household.account.accountKey], currency: { code: 'EUR', currencyKey: household.currency.currencyKey }, period: 'monthly', periodStartDay: 1, templateKeys, tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
      return Object.fromEntries(categories.filter((row) => row.child_category_name).map((row): [string, number] => [String(row.child_category_name), row.category_amount]));
    };

    expect(await spending(ours)).toEqual({ GROCERIES: 0, SAVINGS: 200 });
    expect(await spending(theirs)).toEqual({ GROCERIES: 40, SAVINGS: 0 });
  });

  it('in the dashboard\'s cash flow', async () => {
    const { ours, theirs } = await scenario();
    const cashflow = async ({ household }: Side) => {
      let body: Record<string, unknown> = {};
      const res = { json: (payload: Record<string, unknown>) => { body = payload; return res; }, status: () => res } as unknown as Response;
      await getAccountsCashflow({ body: {}, headers: {}, params: {}, query: { fromDate: RANGE.fromDate }, tenant: household.tenant, user: household.appuser } as unknown as Request, res);
      return body['cashflow'];
    };

    expect(await cashflow(ours)).toEqual([expect.objectContaining({ amount: 300 })]);
    expect(await cashflow(theirs)).toEqual([expect.objectContaining({ amount: 460 })]);
  });
});
