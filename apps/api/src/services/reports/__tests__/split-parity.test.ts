import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { getAccountsCashflow } from '@controller/account/cashflow';
import { getCategorySpending } from '@controller/account/transactions';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Category } from '@entity/Category';
import { FxStatus, Transaction } from '@entity/Transaction';
import { AssistantToolsService } from '@service/assistant/assistant-tools.service';
import { classifyTransactions, createDiagnostics } from '@service/budget/aggregation-classifier';
import { getBudgetSpending } from '@service/budget/spending';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { getBudgetVsActualReport } from '@service/reports/budgetVsActual.service';
import { getCashflowReport } from '@service/reports/cashflow.service';
import { getSankeyReport } from '@service/reports/sankey.service';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { setTransactionSplits } from '@service/transaction/transaction-split.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * A split transaction must count exactly like the same spending entered as separate transactions,
 * in every total: budgets, every report, the dashboard and the monthly emails. Each test builds two
 * households with the same categories: one pays with a single split transaction, the other with
 * one transaction per line, and every total must come out the same, category by category.
 *
 * The second payment is in dollars, converted at a rate whose shares need rounding, so the totals
 * read in SQL (budgets, monthly emails) and in JavaScript (reports, dashboard) must also round the
 * shares the same way.
 */
describe('a split transaction counts like separate transactions', () => {
  const db = useTestDatabase();
  const JULY_10 = new Date('2026-07-10T12:00:00Z');
  const JULY_12 = new Date('2026-07-12T12:00:00Z');
  const RANGE = { fromDate: '2026-07-01T00:00:00Z', toDate: '2026-07-31T23:59:59Z' };

  interface Scenario {
    accountKeys: number[];
    groceries: Category;
    homeware: Category;
    household: Household;
    templateKeys: number[];
  }

  /** Shopping > Groceries, Homeware, owned by the household's owner (the monthly emails count a member's own categories). */
  async function categories(household: Household) {
    const em = db.em();
    const shopping = await addCategory(em, household, 'Shopping');
    const groceries = await addCategory(em, household, 'Groceries', shopping);
    const homeware = await addCategory(em, household, 'Homeware', shopping);
    for (const category of [shopping, groceries, homeware]) category.appuserKey = household.appuser;
    await em.flush();
    return { groceries, homeware };
  }

  /** A dollar account; its rows are stored converted at 0.913578 (50 USD -> 45.6789 EUR). */
  async function dollarAccount(household: Household) {
    const em = db.em();
    return addAccount(em, household, { currency: await currencyFor(em, 'USD'), name: 'Dollars' });
  }

  async function inDollars(transaction: Transaction, usdAmount: number, eurAmount: null | number) {
    const em = db.em();
    const stored = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    const usd = await currencyFor(em, 'USD');
    Object.assign(stored, { appuserSettlementAmount: eurAmount, fxStatus: eurAmount === null ? FxStatus.MISSING : FxStatus.EXACT, originalAmount: usdAmount, originalCurrencyKey: usd, settlementAmount: usdAmount, settlementCurrencyKey: usd });
    await em.flush();
  }

  async function budgetFor(household: Household, budgeted: Category[]): Promise<number[]> {
    const em = db.em();
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const templates = budgeted.map((category) => em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: category, month: 7, year: 2026 }, { partial: true }));
    await em.flush();
    return templates.map((template) => template.budgetTemplateCategoryKey);
  }

  /** One card payment of 100 split 60 / 25 / 15 (uncategorized), and 50 USD split 20 / 30. */
  async function splitHousehold(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const { groceries, homeware } = await categories(household);
    const dollars = await dollarAccount(household);
    await addTransaction(em, household, { amount: 500, date: JULY_10, status: 'BOOKED' });
    const card = await addTransaction(em, household, { amount: -100, category: groceries, date: JULY_10, status: 'BOOKED' });
    const usd = await addTransaction(em, household, { account: dollars, amount: -50, category: groceries, date: JULY_12, status: 'BOOKED' });
    await inDollars(usd, -50, -45.6789);
    const actor = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    await setTransactionSplits(db.em(), actor, card.transactionKey, [
      { amount: -60, categoryKey: groceries.categoryKey },
      { amount: -25, categoryKey: homeware.categoryKey },
      { amount: -15, categoryKey: null },
    ]);
    await setTransactionSplits(db.em(), actor, usd.transactionKey, [{ amount: -20, categoryKey: groceries.categoryKey }, { amount: -30, categoryKey: homeware.categoryKey }]);
    return { accountKeys: [household.account.accountKey, dollars.accountKey], groceries, homeware, household, templateKeys: await budgetFor(household, [groceries, homeware]) };
  }

  /** The same spending, one transaction per line; the dollar lines at their rounded shares. */
  async function separateHousehold(): Promise<Scenario> {
    const em = db.em();
    const household = await seedHousehold(em);
    const { groceries, homeware } = await categories(household);
    const dollars = await dollarAccount(household);
    await addTransaction(em, household, { amount: 500, date: JULY_10, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -60, category: groceries, date: JULY_10, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -25, category: homeware, date: JULY_10, status: 'BOOKED' });
    await addTransaction(em, household, { amount: -15, date: JULY_10, status: 'BOOKED' });
    await inDollars(await addTransaction(em, household, { account: dollars, amount: -20, category: groceries, date: JULY_12, status: 'BOOKED' }), -20, -18.2716);
    await inDollars(await addTransaction(em, household, { account: dollars, amount: -30, category: homeware, date: JULY_12, status: 'BOOKED' }), -30, -27.4073);
    return { accountKeys: [household.account.accountKey, dollars.accountKey], groceries, homeware, household, templateKeys: await budgetFor(household, [groceries, homeware]) };
  }

  async function both<T>(measure: (scenario: Scenario) => Promise<T>): Promise<{ separate: T; split: T }> {
    const split = await measure(await splitHousehold());
    const separate = await measure(await separateHousehold());
    return { separate, split };
  }

  /** The households keep their books, and their budgets, in euros. */
  const EUR = (scenario: Scenario) => ({ code: 'EUR', currencyKey: scenario.household.currency.currencyKey });

  const reportInput = (scenario: Scenario, extra: Record<string, unknown> = {}) => ({ filters: reportFiltersSchema.parse({ ...RANGE, ...extra }), tenant: scenario.household.tenant, user: scenario.household.appuser });

  async function callHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>, scenario: Scenario, query: Record<string, string>): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    const res = { json: (payload: Record<string, unknown>) => { body = payload; return res; }, status: () => res } as unknown as Response;
    await handler({ body: {}, headers: {}, params: {}, query, tenant: scenario.household.tenant, user: scenario.household.appuser } as unknown as Request, res, () => undefined);
    return body;
  }

  it('in budget spending', async () => {
    const { separate, split } = await both(async (scenario) => {
      const { categories: rows } = await getBudgetSpending({ accountKeys: scenario.accountKeys, currency: EUR(scenario), period: 'monthly', periodStartDay: 1, templateKeys: scenario.templateKeys, tenantKey: scenario.household.tenant.tenantKey, viewerAppuserKey: scenario.household.appuser.appuserKey });
      return Object.fromEntries(rows.map((row) => [row.child_category_name ?? `parent:${row.parent_category_name}`, row.category_amount]));
    });

    expect(split).toEqual(separate);
    expect(split).toMatchObject({ Groceries: 78.2716, Homeware: 52.4073, 'parent:Shopping': 130.6789 });
  });

  it('in spending by category', async () => {
    const { separate, split } = await both(async (scenario) => {
      const report = await getSpendingByCategoryReport(reportInput(scenario));
      return Object.fromEntries(report.data.map((row) => [row.name, [row.totalAmount, row.transactionCount, row.percentOfTotal]]));
    });

    expect(split).toEqual(separate);
    expect(split).toMatchObject({ Groceries: [78.27, 2, expect.any(Number)], Homeware: [52.41, 2, expect.any(Number)], Uncategorized: [15, 1, expect.any(Number)] });
  });

  it('in budget vs actual', async () => {
    const { separate, split } = await both(async (scenario) => {
      const report = await getBudgetVsActualReport(reportInput(scenario));
      return Object.fromEntries(report.data.map((row) => [row.name, row.actual]));
    });

    expect(split).toEqual(separate);
    expect(split).toEqual({ Groceries: 78.27, Homeware: 52.41 });
  });

  it('in cash flow, counting only the filtered category\'s lines', async () => {
    const { separate, split } = await both(async (scenario) => {
      const all = await getCashflowReport(reportInput(scenario));
      const groceriesOnly = await getCashflowReport(reportInput(scenario, { categoryKeys: [String(scenario.groceries.categoryKey)] }));
      return { all: all.data, groceriesOnly: groceriesOnly.data };
    });

    expect(split).toEqual(separate);
    expect(split.all).toEqual([expect.objectContaining({ expenses: 145.68, income: 500 })]);
    expect(split.groceriesOnly).toEqual([expect.objectContaining({ expenses: 78.27, income: 0 })]);
  });

  it('in the sankey report', async () => {
    const { separate, split } = await both(async (scenario) => {
      const report = await getSankeyReport(reportInput(scenario));
      return report.data.nodes.filter((node) => node.kind === 'expense').map((node) => [node.label, node.value]).sort();
    });

    expect(split).toEqual(separate);
    expect(split).toEqual([['Groceries', 78.27], ['Homeware', 52.41], ['Uncategorized', 15]]);
  });

  it('in the dashboard\'s category spending', async () => {
    const { separate, split } = await both(async (scenario) => {
      const body = await callHandler(getCategorySpending, scenario, { fromDate: RANGE.fromDate, toDate: RANGE.toDate });
      return (body['categorySpending'] as { amount: number; childCategories: { amount: number; name: string; numTransactions: number }[]; name: string; numTransactions: number }[])
        .map((row) => ({ amount: Number(row.amount.toFixed(4)), children: row.childCategories.map((child) => [child.name, Number(child.amount.toFixed(4)), child.numTransactions]).sort(), name: row.name, numTransactions: row.numTransactions }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    expect(split).toEqual(separate);
    expect(split).toEqual([
      { amount: 130.6789, children: [['Groceries', 78.2716, 2], ['Homeware', 52.4073, 2]], name: 'Shopping', numTransactions: 4 },
      { amount: 15, children: [], name: 'Uncategorized', numTransactions: 1 },
    ]);
  });

  it('in the dashboard\'s cash flow', async () => {
    const { separate, split } = await both(async (scenario) => (await callHandler(getAccountsCashflow, scenario, { fromDate: RANGE.fromDate }))['cashflow']);

    expect(split).toEqual(separate);
    expect(split).toEqual([expect.objectContaining({ amount: 354.32 })]);
  });

  it('in the monthly email and budget alert aggregation', async () => {
    const { separate, split } = await both(async (scenario) => {
      const rows = await new MikroOrmTenantAggregationRepository(db.em()).loadTransactions(scenario.household.appuser.appuserKey, scenario.household.tenant.tenantKey, { end: new Date('2026-08-01T00:00:00Z'), start: new Date('2026-07-01T00:00:00Z') });
      const diagnostics = createDiagnostics();
      const byCategory = new Map<string, number>();
      for (const line of classifyTransactions(rows, scenario.household.appuser.appuserKey, scenario.household.tenant.tenantKey, diagnostics)) {
        byCategory.set(line.categoryName, Number(line.amount.plus(byCategory.get(line.categoryName) ?? 0).toFixed(4)));
      }
      return { byCategory: Object.fromEntries(byCategory), uncategorized: diagnostics.uncategorizedTransactions };
    });

    expect(split.byCategory).toEqual(separate.byCategory);
    expect(split.byCategory).toEqual({ Groceries: 78.2716, Homeware: 52.4073 });
    // The uncategorized line is left out like an uncategorized transaction (the separate household
    // also has an uncategorized income row).
    expect(split.uncategorized).toBe(separate.uncategorized);
  });

  it('in the assistant\'s spending by category', async () => {
    const { separate, split } = await both(async (scenario) => {
      const tools = AssistantToolsService.createTools({ appuserKey: scenario.household.appuser.appuserKey, consentVersion: 1, conversationId: 'c-1', currency: 'EUR', tenantKey: scenario.household.tenant.tenantKey }) as unknown as Record<string, { execute: (input: unknown, options: unknown) => Promise<{ data: { categories: { amount: number; category: string }[] } }> }>;
      // July 2026 falls in the last twelve months.
      const result = await tools['get_spending_by_category']!.execute({ period: 'last_12_months' }, {});
      return result.data.categories.map((row) => [row.category, Number(row.amount.toFixed(4))]).sort();
    });

    expect(split).toEqual(separate);
    expect(split).toEqual([['Groceries', 78.2716], ['Homeware', 52.4073]]);
  });

  it('never counts the lines of a transaction the budget must not count', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    const { groceries, homeware } = await categories(household);
    const privateAccount = await addAccount(em, household, { isPrivate: true, name: 'Private' });
    const secret = await addTransaction(em, household, { account: privateAccount, amount: -100, category: groceries, date: JULY_10, status: 'BOOKED' });
    const expired = await addTransaction(em, household, { amount: -40, category: groceries, date: JULY_10, status: 'EXPIRED' });
    const actor = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
    await setTransactionSplits(db.em(), actor, secret.transactionKey, [{ amount: -70, categoryKey: groceries.categoryKey }, { amount: -30, categoryKey: homeware.categoryKey }]);
    await setTransactionSplits(db.em(), actor, expired.transactionKey, [{ amount: -20, categoryKey: groceries.categoryKey }, { amount: -20, categoryKey: homeware.categoryKey }]);
    const templateKeys = await budgetFor(household, [groceries, homeware]);
    const spending = async (viewer: number, accountKeys: number[]) => (await getBudgetSpending({ accountKeys, currency: { code: 'EUR', currencyKey: household.currency.currencyKey }, period: 'monthly', periodStartDay: 1, templateKeys, tenantKey: household.tenant.tenantKey, viewerAppuserKey: viewer })).categories
      .filter((row) => row.child_category_name)
      .map((row) => [row.child_category_name, row.category_amount])
      .sort();

    // The partner cannot see the private account; the expired payment never moved money.
    expect(await spending(partner.appuserKey, [household.account.accountKey, privateAccount.accountKey])).toEqual([['Groceries', 0], ['Homeware', 0]]);
    // An account the budget does not cover.
    expect(await spending(household.appuser.appuserKey, [household.account.accountKey])).toEqual([['Groceries', 0], ['Homeware', 0]]);
    expect(await spending(household.appuser.appuserKey, [household.account.accountKey, privateAccount.accountKey])).toEqual([['Groceries', 70], ['Homeware', 30]]);
  });

  describe('when the transaction has no converted amount', () => {
    async function unconvertedSplit(): Promise<Scenario> {
      const em = db.em();
      const household = await seedHousehold(em);
      const { groceries, homeware } = await categories(household);
      const dollars = await dollarAccount(household);
      const usd = await addTransaction(em, household, { account: dollars, amount: -50, category: groceries, date: JULY_12, status: 'BOOKED' });
      await inDollars(usd, -50, null);
      await setTransactionSplits(db.em(), { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, usd.transactionKey, [{ amount: -20, categoryKey: groceries.categoryKey }, { amount: -30, categoryKey: homeware.categoryKey }]);
      return { accountKeys: [household.account.accountKey, dollars.accountKey], groceries, homeware, household, templateKeys: await budgetFor(household, [groceries, homeware]) };
    }

    it('leaves every line out and counts the transaction once as unconverted', async () => {
      const scenario = await unconvertedSplit();
      const input = { accountKeys: scenario.accountKeys, currency: EUR(scenario), period: 'monthly' as const, periodStartDay: 1, templateKeys: scenario.templateKeys, tenantKey: scenario.household.tenant.tenantKey, viewerAppuserKey: scenario.household.appuser.appuserKey };

      const { categories: budget, completeness: budgetCompleteness } = await getBudgetSpending(input);
      const report = await getCashflowReport(reportInput(scenario, { categoryKeys: [String(scenario.groceries.categoryKey), String(scenario.homeware.categoryKey)] }));

      expect(budget.filter((row) => row.child_category_name).map((row) => row.category_amount)).toEqual([0, 0]);
      expect(budgetCompleteness).toMatchObject({ isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
      expect(report.data).toEqual([]);
      expect(report.completeness).toMatchObject({ isComplete: false, unconvertedTransactions: 1 });
    });
  });
});
