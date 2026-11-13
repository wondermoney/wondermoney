import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { getAccountsCashflow } from '@controller/account/cashflow';
import { getCategorySpending } from '@controller/account/transactions';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import { FxStatus, Transaction } from '@entity/Transaction';
import { AssistantToolsService } from '@service/assistant/assistant-tools.service';
import { classifyTransactions, createDiagnostics } from '@service/budget/aggregation-classifier';
import { suggestBudgetAmounts } from '@service/budget/budget-suggestions.service';
import { getBudgetSpending } from '@service/budget/spending';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { getBudgetVsActualReport } from '@service/reports/budgetVsActual.service';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { getSankeyReport } from '@service/reports/sankey.service';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { linkReimbursement } from '@service/transaction/transaction-reimbursement.service';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';
import { getTransactionTotal } from '@service/transaction/transaction-total.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * A refund linked to the expense it offsets must count exactly like the net expense entered on its
 * own, in every total: budgets, every report, the dashboard, the transaction list's total, the
 * monthly emails and the assistant. Each test builds two households with the same categories:
 *
 * - "linked" pays 50 split 30 Groceries / 20 Homeware and gets 20 back, linked to the payment; and
 *   pays 50 USD in Groceries (stored as 45.6789 EUR) and gets 20 USD back, linked;
 * - "net" pays 18 Groceries and 12 Homeware (the split, pro rata on the 30 left), and 30 USD in
 *   Groceries (stored as 27.4073 EUR, the same conversion).
 *
 * Both earn 500. The refunds are income in neither: they are taken off the expenses.
 */
describe('a linked reimbursement counts like the net expense', () => {
  const db = useTestDatabase();
  const JULY_10 = new Date('2026-07-10T12:00:00Z');
  const JULY_12 = new Date('2026-07-12T12:00:00Z');
  const JULY_15 = new Date('2026-07-15T12:00:00Z');
  const RANGE = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };

  interface Scenario {
    accountKeys: number[];
    groceries: Category;
    homeware: Category;
    household: Household;
    templateKeys: number[];
  }

  async function categories(household: Household) {
    const em = db.em();
    const shopping = await addCategory(em, household, 'Shopping');
    const groceries = await addCategory(em, household, 'Groceries', shopping);
    const homeware = await addCategory(em, household, 'Homeware', shopping);
    for (const category of [shopping, groceries, homeware]) category.appuserKey = household.appuser;
    await em.flush();
    return { groceries, homeware };
  }

  async function inDollars(transaction: Transaction, usdAmount: number, eurAmount: number) {
    const em = db.em();
    const stored = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    const usd = await currencyFor(em, 'USD');
    Object.assign(stored, { appuserSettlementAmount: eurAmount, fxStatus: FxStatus.EXACT, originalAmount: usdAmount, originalCurrencyKey: usd, settlementAmount: usdAmount, settlementCurrencyKey: usd });
    await em.flush();
  }

  async function budgetFor(household: Household, budgeted: Category[]): Promise<number[]> {
    const em = db.em();
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const templates = budgeted.map((category) => em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: category, month: 7, year: 2026 }, { partial: true }));
    await em.flush();
    return templates.map((template) => template.budgetTemplateCategoryKey);
  }

  async function linkedHousehold(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const { groceries, homeware } = await categories(household);
    const dollars = await addAccount(em, household, { currency: await currencyFor(em, 'USD'), name: 'Dollars' });
    const actor = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    await addTransaction(em, household, { amount: 500, date: JULY_10, status: 'BOOKED' });
    const card = await addTransaction(em, household, { amount: -50, category: groceries, date: JULY_10, status: 'BOOKED' });
    await setTransactionSplits(db.em(), actor, card.transactionKey, [{ amount: -30, categoryKey: groceries.categoryKey }, { amount: -20, categoryKey: homeware.categoryKey }]);
    const refund = await addTransaction(em, household, { amount: 20, date: JULY_15, status: 'BOOKED' });
    await linkReimbursement(db.em(), actor, refund.transactionKey, { amount: 20, expenseTransactionKey: card.transactionKey });

    const usd = await addTransaction(em, household, { account: dollars, amount: -50, category: groceries, date: JULY_12, status: 'BOOKED' });
    await inDollars(usd, -50, -45.6789);
    const usdRefund = await addTransaction(em, household, { account: dollars, amount: 20, date: JULY_15, status: 'BOOKED' });
    await inDollars(usdRefund, 20, 18.2716);
    await linkReimbursement(db.em(), actor, usdRefund.transactionKey, { amount: 20, expenseTransactionKey: usd.transactionKey });
    return { accountKeys: [household.account.accountKey, dollars.accountKey], groceries, homeware, household, templateKeys: await budgetFor(household, [groceries, homeware]) };
  }

  async function netHousehold(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const { groceries, homeware } = await categories(household);
    const dollars = await addAccount(em, household, { currency: await currencyFor(em, 'USD'), name: 'Dollars' });
    await addTransaction(em, household, { amount: 500, date: JULY_10, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -18, category: groceries, date: JULY_10, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -12, category: homeware, date: JULY_10, status: 'BOOKED' });
    await inDollars(await addTransaction(em, household, { account: dollars, amount: -30, category: groceries, date: JULY_12, status: 'BOOKED' }), -30, -27.4073);
    return { accountKeys: [household.account.accountKey, dollars.accountKey], groceries, homeware, household, templateKeys: await budgetFor(household, [groceries, homeware]) };
  }

  async function both<T>(measure: (scenario: Scenario) => Promise<T>): Promise<{ linked: T; net: T }> {
    const linked = await measure(await linkedHousehold());
    const net = await measure(await netHousehold());
    return { linked, net };
  }

  const EUR = (scenario: Scenario) => ({ code: 'EUR', currencyKey: scenario.household.currency.currencyKey });
  const reportInput = (scenario: Scenario, extra: Record<string, unknown> = {}) => ({ filters: reportFiltersSchema.parse({ ...RANGE, ...extra }), tenant: scenario.household.tenant, user: scenario.household.appuser });

  async function callHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>, scenario: Scenario, query: Record<string, string>): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    const res = { json: (payload: Record<string, unknown>) => { body = payload; return res; }, status: () => res } as unknown as Response;
    await handler({ body: {}, headers: {}, params: {}, query, tenant: scenario.household.tenant, user: scenario.household.appuser } as unknown as Request, res, () => undefined);
    return body;
  }

  it('in budget spending', async () => {
    const { linked, net } = await both(async (scenario) => {
      const { categories: rows } = await getBudgetSpending({ accountKeys: scenario.accountKeys, currency: EUR(scenario), period: 'monthly', periodStartDay: 1, templateKeys: scenario.templateKeys, tenantKey: scenario.household.tenant.tenantKey, viewerAppuserKey: scenario.household.appuser.appuserKey });
      return Object.fromEntries(rows.map((row) => [row.child_category_name ?? `parent:${row.parent_category_name}`, row.category_amount]));
    });

    expect(linked).toEqual(net);
    expect(linked).toMatchObject({ Groceries: 45.4073, Homeware: 12, 'parent:Shopping': 57.4073 });
  });

  it('in budget suggestions', async () => {
    const { linked, net } = await both(async (scenario) => {
      const budget = await db.em().findOneOrFail(Budget, { appuserKey: scenario.household.appuser }, { filters: false });
      const result = await suggestBudgetAmounts({ accountKeys: scenario.accountKeys, budgetKey: budget.budgetKey, months: 3, targetMonth: { month: 8, year: 2026 }, tenantKey: scenario.household.tenant.tenantKey, viewerAppuserKey: scenario.household.appuser.appuserKey }, db.em());
      return result.categories.map((row) => [row.categoryName, row.average, row.median]).sort();
    });

    expect(linked).toEqual(net);
  });

  it('in spending by category', async () => {
    const { linked, net } = await both(async (scenario) => {
      const report = await getSpendingByCategoryReport(reportInput(scenario));
      return Object.fromEntries(report.data.map((row) => [row.name, [row.totalAmount, row.percentOfTotal]]));
    });

    expect(linked).toEqual(net);
    expect(linked).toMatchObject({ Groceries: [45.41, expect.any(Number)], Homeware: [12, expect.any(Number)] });
  });

  it('in budget vs actual', async () => {
    const { linked, net } = await both(async (scenario) => {
      const report = await getBudgetVsActualReport(reportInput(scenario));
      return Object.fromEntries(report.data.map((row) => [row.name, row.actual]));
    });

    expect(linked).toEqual(net);
    expect(linked).toEqual({ Groceries: 45.41, Homeware: 12 });
  });

  it('in cash flow: the refunds are not income', async () => {
    const { linked, net } = await both(async (scenario) => (await getCashflowReport(reportInput(scenario))).data);

    expect(linked).toEqual(net);
    expect(linked).toEqual([expect.objectContaining({ expenses: 57.41, income: 500 })]);
  });

  it('in the sankey report', async () => {
    const { linked, net } = await both(async (scenario) => {
      const report = await getSankeyReport(reportInput(scenario));
      return report.data.nodes.map((node) => [node.kind, node.label, node.value]).sort();
    });

    expect(linked).toEqual(net);
  });

  it('in the dashboard\'s category spending', async () => {
    const { linked, net } = await both(async (scenario) => {
      const body = await callHandler(getCategorySpending, scenario, { fromDate: RANGE.fromDate, toDate: RANGE.toDate });
      return (body['categorySpending'] as { amount: number; childCategories: { amount: number; name: string }[]; name: string }[])
        .map((row) => ({ amount: Number(row.amount.toFixed(4)), children: row.childCategories.map((child) => [child.name, Number(child.amount.toFixed(4))]).sort(), name: row.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    expect(linked).toEqual(net);
    expect(linked).toEqual([{ amount: 57.4073, children: [['Groceries', 45.4073], ['Homeware', 12]], name: 'Shopping' }]);
  });

  it('in the dashboard\'s cash flow and savings rate', async () => {
    const { linked, net } = await both(async (scenario) => (await callHandler(getAccountsCashflow, scenario, { fromDate: RANGE.fromDate }))['cashflow']);

    expect(linked).toEqual(net);
    expect(linked).toEqual([expect.objectContaining({ amount: 442.59 })]);
  });

  it('in the transaction list\'s total for a category', async () => {
    const { linked, net } = await both(async (scenario) => {
      const total = await getTransactionTotal(
        { categoryKeys: { includeUncategorized: false, keys: [scenario.groceries.categoryKey] }, fromDate: new Date(RANGE.fromDate), toDate: new Date(RANGE.toDate) },
        { currency: EUR(scenario), tenantKey: scenario.household.tenant.tenantKey, viewerAppuserKey: scenario.household.appuser.appuserKey },
      );
      return { amount: total.amount, moneyIn: total.moneyIn, moneyOut: total.moneyOut };
    });

    expect(linked).toEqual(net);
    expect(linked).toEqual({ amount: -45.4073, moneyIn: 0, moneyOut: 45.4073 });
  });

  it('in the monthly email, budget alert and insights aggregation', async () => {
    const { linked, net } = await both(async (scenario) => {
      const rows = await new MikroOrmTenantAggregationRepository(db.em()).loadTransactions(scenario.household.appuser.appuserKey, scenario.household.tenant.tenantKey, { end: new Date('2026-08-01T00:00:00Z'), start: new Date('2026-07-01T00:00:00Z') });
      const byCategory = new Map<string, number>();
      for (const line of classifyTransactions(rows, scenario.household.appuser.appuserKey, scenario.household.tenant.tenantKey, createDiagnostics())) {
        byCategory.set(line.categoryName, Number(line.amount.plus(byCategory.get(line.categoryName) ?? 0).toFixed(4)));
      }
      return Object.fromEntries(byCategory);
    });

    expect(linked).toEqual(net);
    expect(linked).toEqual({ Groceries: 45.4073, Homeware: 12 });
  });

  it('in the assistant\'s spending by category and cash flow summary', async () => {
    const { linked, net } = await both(async (scenario) => {
      const tools = AssistantToolsService.createTools({ appuserKey: scenario.household.appuser.appuserKey, consentVersion: 1, conversationId: 'c-1', currency: 'EUR', tenantKey: scenario.household.tenant.tenantKey }) as unknown as Record<string, { execute: (input: unknown, options: unknown) => Promise<{ data: Record<string, unknown> }> }>;
      const spending = await tools['get_spending_by_category']!.execute({ period: 'last_12_months' }, {});
      const cashflow = await tools['get_cashflow_summary']!.execute({ period: 'last_12_months' }, {});
      const categoriesOut = (spending.data['categories'] as { amount: number; category: string }[]).map((row) => [row.category, Number(row.amount.toFixed(4))]).sort();
      const { inflow, net: total, outflow } = cashflow.data as { inflow: number; net: number; outflow: number };
      return { categories: categoriesOut, inflow: Number(inflow.toFixed(4)), net: Number(total.toFixed(4)), outflow: Number(outflow.toFixed(4)) };
    });

    expect(linked).toEqual(net);
    expect(linked.categories).toEqual([['Groceries', 45.4073], ['Homeware', 12]]);
    expect(linked.inflow).toBe(500);
  });
});
