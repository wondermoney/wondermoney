import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { z } from 'zod';

import { DI } from '@app/app';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Category } from '@entity/Category';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { type BudgetMonth, budgetMonthOf, budgetPeriodRange, type BudgetPeriodSettings, shiftBudgetMonth } from '@service/budget/budget-period';
import { budgetVisibilityOf, HOUSEHOLD_BUDGETS_FIRST } from '@service/budget/budget-visibility';
import { MikroOrmTenantAggregationRepository } from '@service/budget/tenant-aggregation.repository';
import { rateScope } from '@service/currency/exchange-rate';
import { GoalService } from '@service/goal/goal.service';
import { InsightsService } from '@service/insights/insights.service';
import netWorthService from '@service/net-worth/net-worth.service';
import portfolioDashboardService from '@service/portfolio/portfolio-dashboard.service';
import portfolioHoldingsService from '@service/portfolio/portfolio-holdings.service';
import { loadRecurringSchedule } from '@service/recurring/recurring-schedule.service';
import { loadViewerCurrencyAmounts } from '@service/reports/report-currency';
import { CATEGORY_LINE_POPULATE, netOfReimbursements, spendingLinesOf } from '@service/transaction/category-lines';
import { loadCategorySpendingFlags } from '@service/transaction/category-spending';
import { excludeExpired } from '@service/transaction/transaction-status';
import { getEffectiveAppuserAmount } from '@utils/account-amounts';
import { getRef } from '@utils/em-helpers';

import { AiToolPeriodService } from './ai-tool-period.service';
import type { AiToolContext, AiToolDataUsed, AiToolDefinition, AiToolResult } from './ai-tool-types';
import { type AiToolViewer, loadAiToolViewer } from './ai-tool-viewer';

const periodSchema = z.enum(['current_month', 'previous_month', 'last_90_days', 'year_to_date', 'last_12_months']);
const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, { message: 'Month must be YYYY-MM' });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' });

type PeriodInput = z.infer<typeof periodSchema>;
type TransactionLike = Pick<Transaction, 'appuserSettlementAmount' | 'editedSettlementAmount' | 'transactionTypeKey'>;

/** How many rows `search_transactions` and the large-transaction summary read before filtering. */
const SEARCH_SCAN_LIMIT = 500;

function baseCurrency(viewer: AiToolViewer, context: AiToolContext): string {
  return viewer.appuser.currencyKey.code || context.currency;
}

function defineTool<S extends z.ZodObject<z.ZodRawShape>, TData>(
  name: AiToolDefinition['name'],
  description: string,
  inputSchema: S,
  execute: (input: z.infer<S>, context: AiToolContext) => Promise<AiToolResult<TData>>,
): AiToolDefinition<z.infer<S>, TData> {
  return { description, execute, inputSchema, name };
}

function emptyResult<TData>(data: TData, granularity: string, period = 'current'): AiToolResult<TData> {
  return result(data, { granularity, period, recordCount: 0 });
}

function result<TData>(data: TData, dataUsed: Omit<AiToolDataUsed, 'source'>): AiToolResult<TData> {
  return { data, dataUsed: { ...dataUsed, source: 'database' } };
}

async function withViewer<TData>(
  context: AiToolContext,
  run: (viewer: AiToolViewer) => Promise<AiToolResult<TData>>,
  empty: () => AiToolResult<TData>,
): Promise<AiToolResult<TData>> {
  const viewer = await loadAiToolViewer(context);
  if (!viewer) return empty();
  return run(viewer);
}

/**
 * The read-only finance tools, shared by the in-app assistant and the MCP server.
 *
 * Every tool takes the caller's `appuserKey` and `tenantKey` and reads through the request
 * EntityManager, so the global tenant filter and its per-account privacy carve-out apply to
 * every query. Aggregates are converted into the caller's base currency; a per-record figure
 * names its own currency.
 */
export const AI_TOOL_DEFINITIONS: readonly AiToolDefinition<never>[] = [
  defineTool('compare_budget_periods', 'Read-only comparison of this month\'s budget with last month\'s: budgeted, spent and remaining, in the budget currency.', z.object({ period: periodSchema.optional() }), async (input, context) =>
    withViewer(context, async (viewer) => {
      const current = await budgetStatusFor(viewer, input.period ?? 'current_month');
      const previous = await budgetStatusFor(viewer, 'previous_month');
      return result(
        {
          comparison: [
            { ...current, period: 'current_month' },
            { ...previous, period: 'previous_month' },
          ],
          currency: current.currency,
        },
        { granularity: 'budget_status', period: 'current_month', recordCount: current.recordCount + previous.recordCount },
      );
    }, () => emptyResult({ comparison: [], currency: context.currency }, 'budget_status'))),

  defineTool('get_account_balance_summary', 'Read-only, privacy-minimizing summary of account balances in the caller\'s base currency. Private accounts of other household members are excluded.', z.object({ period: periodSchema.optional() }), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const summary = await netWorthService.getNetWorth(viewer.appuser);
      const accounts = summary.rows
        .filter((row) => row.type === 'accounts')
        .map((row) => ({ balance: row.balance, currency: summary.currencyCode, name: row.name }));
      return result(
        { accounts, currency: summary.currencyCode, total: summary.assets.accounts },
        { granularity: 'account_balances', period: 'current', recordCount: accounts.length },
      );
    }, () => emptyResult({ accounts: [], currency: context.currency, total: 0 }, 'account_balances'))),

  defineTool('get_budget_status', 'Read-only, privacy-minimizing budget status summary for a period, in the budget currency.', z.object({ period: periodSchema.default('current_month') }), async (input, context) =>
    withViewer(context, async (viewer) => {
      const status = await budgetStatusFor(viewer, input.period);
      return result(
        { budgeted: status.budgeted, currency: status.currency, remaining: status.remaining, spent: status.spent, status: status.status },
        { granularity: 'budget_status', period: status.period, recordCount: status.recordCount },
      );
    }, () => emptyResult({ budgeted: 0, currency: context.currency, remaining: 0, spent: 0, status: 'no_tenant_access' }, 'budget_status', input.period))),

  defineTool('get_cashflow_summary', 'Read-only, privacy-minimizing cashflow summary: money in, money out and net, in the caller\'s base currency.', z.object({ period: periodSchema.default('current_month') }), async (input, context) =>
    withViewer(context, async (viewer) => {
      const resolved = AiToolPeriodService.resolve(input.period);
      const transactions = (await findScopedTransactions(viewer, resolved)).filter((transaction) => !isTransfer(transaction));
      const totals = transactions.reduce(
        (acc, transaction) => {
          // Net of reimbursement links, as every total reads it (`category-lines.ts`).
          const amount = netOfReimbursements(transaction, getEffectiveAmount(transaction)) ?? 0;
          if (amount > 0) acc.inflow += amount;
          if (amount < 0) acc.outflow += Math.abs(amount);
          acc.net += amount;
          return acc;
        },
        { inflow: 0, net: 0, outflow: 0 },
      );
      return result(
        { currency: baseCurrency(viewer, context), ...totals },
        { granularity: resolved.granularity, period: resolved.key, recordCount: transactions.length },
      );
    }, () => emptyResult({ currency: context.currency, inflow: 0, net: 0, outflow: 0 }, 'month', input.period))),

  defineTool('get_goal_progress_summary', 'Read-only progress of every active savings or debt-paydown goal.', z.object({ period: periodSchema.optional() }), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const goals = await new GoalService(DI.em).listGoals({ appuserKey: viewer.appuser.appuserKey, tenantKey: viewer.tenant.tenantKey });
      const rows = goals.map((goal) => ({
        availableAmount: goal.summary.availableAmount,
        currency: goal.currencyCode ?? baseCurrency(viewer, context),
        name: goal.name,
        progress: goal.summary.progressPercentage,
        status: goal.summary.status,
        targetAmount: goal.targetAmount,
      }));
      return result(
        { currency: baseCurrency(viewer, context), goals: rows },
        { granularity: 'goal_progress', period: 'current', recordCount: rows.length },
      );
    }, () => emptyResult({ currency: context.currency, goals: [] }, 'goal_progress'))),

  defineTool('get_insights', 'Read-only deterministic spending and budget-pace insights for a month.', z.object({ month: monthSchema.optional() }), async (input, context) =>
    withViewer(context, async (viewer) => {
      // The same service the home cards read, so an answer in chat matches what the person sees.
      const insights = await new InsightsService(new MikroOrmTenantAggregationRepository(DI.em)).getInsights({
        appuserKey: viewer.appuser.appuserKey,
        currency: baseCurrency(viewer, context),
        month: input.month,
        tenantKey: viewer.tenant.tenantKey,
      });
      return result(
        { currency: baseCurrency(viewer, context), insights: insights.insights },
        { granularity: 'insights', period: input.month ?? 'current_month', recordCount: insights.insights.length },
      );
    }, () => emptyResult({ currency: context.currency, insights: [] }, 'insights', input.month ?? 'current_month'))),

  defineTool('get_large_transactions_summary', 'Read-only summary of the ten largest transactions in a period, in the caller\'s base currency. Descriptions are omitted.', z.object({ period: periodSchema.default('current_month') }), async (input, context) =>
    withViewer(context, async (viewer) => {
      const resolved = AiToolPeriodService.resolve(input.period);
      const transactions = (await findScopedTransactions(viewer, resolved, { withCategories: true })).filter((transaction) => !isTransfer(transaction));
      const amounts = await loadViewerCurrencyAmounts(DI.em, viewer.appuser, rateScope(viewer.tenant), transactions);
      const rows = transactions
        .flatMap((transaction) => {
          const amount = amounts.amountOf(transaction);
          if (amount === null) return [];
          return [{ amount, category: categoryNameOf(transaction), currency: baseCurrency(viewer, context), date: transaction.transactionDate?.toISOString() ?? null }];
        })
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 10);
      return result(
        { currency: baseCurrency(viewer, context), transactions: rows },
        { granularity: 'large_transactions', period: resolved.key, recordCount: rows.length },
      );
    }, () => emptyResult({ currency: context.currency, transactions: [] }, 'large_transactions', input.period))),

  defineTool('get_net_worth_summary', 'Read-only, privacy-minimizing summary of current net worth: assets, liabilities and the total, in the caller\'s base currency.', z.object({ period: periodSchema.optional() }), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const summary = await netWorthService.getNetWorth(viewer.appuser);
      return result(
        {
          assets: summary.assets,
          currency: summary.currencyCode,
          isComplete: summary.isComplete,
          liabilities: summary.liabilities,
          netWorth: summary.totalNetWorth,
        },
        { granularity: 'net_worth', period: 'current', recordCount: summary.rows.length },
      );
    }, () => emptyResult({ assets: { accounts: 0, manualAssets: 0, portfolios: 0 }, currency: context.currency, isComplete: true, liabilities: { loans: 0 }, netWorth: 0 }, 'net_worth'))),

  defineTool('get_portfolio_income_summary', 'Read-only dividend income received, in the caller\'s base currency.', z.object({ period: periodSchema.optional() }), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const income = await portfolioHoldingsService.getDividendIncome(viewer.appuser, undefined, viewer.tenant.tenantKey);
      return result(
        {
          byAsset: income.byAsset.map((asset) => ({ amount: asset.totalDividends, symbol: asset.symbol })),
          currency: income.completeness.currencyCode,
          total: income.totalDividends,
        },
        { granularity: 'portfolio_income', period: 'all_time', recordCount: income.byAsset.length },
      );
    }, () => emptyResult({ byAsset: [], currency: context.currency, total: 0 }, 'portfolio_income'))),

  defineTool('get_portfolio_summary', 'Read-only portfolio summary: value, gains and the share of each portfolio, in the caller\'s base currency.', z.object({ period: periodSchema.optional() }), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const dashboard = await portfolioDashboardService.getAggregateDashboard(viewer.appuser, 'YTD', viewer.tenant.tenantKey);
      return result(
        {
          currency: dashboard.summary.currency,
          portfolios: dashboard.portfolios.map((portfolio) => ({ name: portfolio.name, value: portfolio.value, weight: portfolio.weight })),
          portfolioValue: dashboard.summary.totalValue,
          totalGainLoss: dashboard.summary.totalGainLoss,
          totalGainLossPercent: dashboard.summary.totalGainLossPercent,
        },
        { granularity: 'portfolio_summary', period: 'YTD', recordCount: dashboard.portfolios.length },
      );
    }, () => emptyResult({ currency: context.currency, portfolios: [], portfolioValue: 0, totalGainLoss: 0, totalGainLossPercent: 0 }, 'portfolio_summary'))),

  defineTool('get_recurring_payments_summary', 'Read-only recurring payments expected in the next 30 days, with their expected amount and currency.', z.object({ period: periodSchema.optional() }), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const now = new Date();
      const entries = await loadRecurringSchedule({ from: now, tenantKey: viewer.tenant.tenantKey, to: new Date(now.getTime() + 30 * 86_400_000) });
      const recurringPayments = entries.map((entry) => ({
        amount: entry.expectedAmount,
        currency: entry.currency ?? baseCurrency(viewer, context),
        date: entry.date.toISOString(),
        name: entry.name,
        status: entry.status,
      }));
      return result(
        { currency: baseCurrency(viewer, context), recurringPayments },
        { granularity: 'recurring_payments', period: 'next_30_days', recordCount: recurringPayments.length },
      );
    }, () => emptyResult({ currency: context.currency, recurringPayments: [] }, 'recurring_payments', 'next_30_days'))),

  defineTool('get_spending_by_category', 'Read-only, privacy-minimizing spending breakdown by category, in the caller\'s base currency.', z.object({ period: periodSchema.default('current_month') }), async (input, context) =>
    withViewer(context, async (viewer) => {
      const resolved = AiToolPeriodService.resolve(input.period);
      const categoryLinks = (await findOwnSpendingLines(viewer, resolved)).filter((line) => line.category !== null);
      const totalsByCategory = new Map<string, number>();
      for (const line of categoryLinks) {
        if (!line.category) continue;
        const categoryName = line.category.name;
        totalsByCategory.set(categoryName, (totalsByCategory.get(categoryName) ?? 0) + Math.abs(line.amount ?? 0));
      }
      const categories = Array.from(totalsByCategory.entries())
        .map(([category, amount]) => ({ amount, category }))
        .sort((a, b) => b.amount - a.amount);
      return result(
        { categories, currency: baseCurrency(viewer, context) },
        { granularity: 'category_totals', period: resolved.key, recordCount: categoryLinks.length },
      );
    }, () => emptyResult({ categories: [], currency: context.currency }, 'category_totals', input.period))),

  defineTool('get_spending_trend', 'Read-only monthly spending for the last six months, in the caller\'s base currency.', z.object({ period: periodSchema.optional() }), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const now = new Date();
      const resolved = { end: endOfMonth(now), granularity: 'month' as const, key: 'last_6_months' as const, start: startOfMonth(subMonths(now, 5)) };
      const transactions = await findOwnSpendingTransactions(viewer, resolved);
      const spendingFlags = await loadCategorySpendingFlags(DI.em, viewer.tenant.tenantKey);
      const totals = new Map<string, number>();
      for (const transaction of transactions) {
        if (!transaction.transactionDate) continue;
        const amount = getEffectiveAmount(transaction);
        if (amount >= 0) continue;
        const month = format(transaction.transactionDate, 'yyyy-MM');
        for (const line of spendingLinesOf(transaction, amount, spendingFlags)) {
          if (!line.category) continue;
          totals.set(month, (totals.get(month) ?? 0) + Math.abs(line.amount ?? 0));
        }
      }
      const trend = [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({ amount, month }));
      return result(
        { currency: baseCurrency(viewer, context), trend },
        { granularity: 'month', period: 'last_6_months', recordCount: trend.length },
      );
    }, () => emptyResult({ currency: context.currency, trend: [] }, 'month', 'last_6_months'))),

  defineTool('list_accounts', 'List the accounts the caller can see: name, type, currency, balance and whether it is closed. Private accounts of other household members are excluded.', z.object({}), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const accounts = await DI.em.find(
        Account,
        { deletedAt: undefined, tenantKey: tenantRef(viewer) },
        { orderBy: { accountName: 'ASC' }, populate: ['accountTypeKey', 'currencyKey'] },
      );
      const rows = accounts.map((account) => ({
        balance: toNumber(account.balance),
        closed: account.closed,
        currency: account.currencyKey.code || baseCurrency(viewer, context),
        id: account.accountKey,
        name: account.accountName ?? 'Account',
        type: account.accountTypeKey?.description ?? null,
      }));
      return result(
        { accounts: rows, currency: baseCurrency(viewer, context) },
        { granularity: 'accounts', period: 'current', recordCount: rows.length },
      );
    }, () => emptyResult({ accounts: [], currency: context.currency }, 'accounts'))),

  defineTool('list_budgets', 'List the budgets the caller can see: the household\'s shared budgets and the caller\'s own personal ones (another member\'s personal budgets are never included). Name, currency, household size and visibility.', z.object({}), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const budgets = await DI.em.find(Budget, { deletedAt: undefined }, { orderBy: HOUSEHOLD_BUDGETS_FIRST, populate: ['currencyKey'] });
      const rows = budgets.map((budget) => ({
        currency: budget.currencyKey.code || baseCurrency(viewer, context),
        id: budget.budgetKey,
        name: budget.name,
        numAdults: budget.numAdults,
        numDependents: budget.numDependents,
        periodStartDay: budget.periodStartDay,
        rolloverCarriesOverspend: budget.rolloverCarriesOverspend,
        visibility: budgetVisibilityOf(budget),
      }));
      return result(
        { budgets: rows, currency: baseCurrency(viewer, context) },
        { granularity: 'budgets', period: 'current', recordCount: rows.length },
      );
    }, () => emptyResult({ budgets: [], currency: context.currency }, 'budgets'))),

  defineTool('list_categories', 'List the spending and income categories available to the household, including the shared system categories.', z.object({}), async (_input, context) =>
    withViewer(context, async (viewer) => {
      const categories = await DI.em.find(Category, { deletedAt: undefined }, { orderBy: { name: 'ASC' }, populate: ['parentCategory'] });
      const rows = categories.map((category) => ({
        countsAsSpending: category.countsAsSpending,
        id: category.categoryKey,
        name: category.name,
        parent: category.parentCategory?.name ?? null,
      }));
      return result(
        { categories: rows, currency: baseCurrency(viewer, context) },
        { granularity: 'categories', period: 'current', recordCount: rows.length },
      );
    }, () => emptyResult({ categories: [], currency: context.currency }, 'categories'))),

  defineTool('search_transactions', 'Search the caller\'s visible transactions by date range, account, category and amount range. Returns at most 100 rows, newest first, with amounts in the caller\'s base currency.', z.object({
    accountId: z.number().int().positive().optional().describe('Only transactions on this account.'),
    amountMax: z.number().optional().describe('Largest absolute amount, in the caller\'s base currency.'),
    amountMin: z.number().optional().describe('Smallest absolute amount, in the caller\'s base currency.'),
    categoryId: z.number().int().positive().optional().describe('Only transactions with a line in this category.'),
    from: dateSchema.optional().describe('First day, YYYY-MM-DD. Defaults to 30 days before `to`.'),
    limit: z.number().int().min(1).max(100).default(50).describe('Maximum rows to return.'),
    to: dateSchema.optional().describe('Last day, YYYY-MM-DD. Defaults to today.'),
  }), async (input, context) =>
    withViewer(context, async (viewer) => {
      const to = input.to ? endOfDay(input.to) : new Date();
      const from = input.from ? startOfDay(input.from) : new Date(to.getTime() - 30 * 86_400_000);
      const where: Record<string, unknown> = excludeExpired({
        accountKey: { closed: false, deletedAt: undefined },
        deletedAt: undefined,
        tenantKey: tenantRef(viewer),
        transactionDate: { $gte: from, $lte: to },
      });
      if (input.accountId !== undefined) {
        where['accountKey'] = { accountKey: input.accountId, closed: false, deletedAt: undefined };
      }

      const transactions = await DI.em.find(Transaction, where, {
        limit: SEARCH_SCAN_LIMIT,
        orderBy: { transactionDate: 'desc' },
        populate: [...CATEGORY_LINE_POPULATE, 'accountKey', 'transactionTypeKey'],
      });
      const amounts = await loadViewerCurrencyAmounts(DI.em, viewer.appuser, rateScope(viewer.tenant), transactions);
      const rows = transactions
        .flatMap((transaction) => {
          if (isTransfer(transaction)) return [];
          const amount = amounts.amountOf(transaction);
          if (amount === null) return [];
          if (input.categoryId !== undefined && !hasCategory(transaction, input.categoryId)) return [];
          if (input.amountMin !== undefined && Math.abs(amount) < input.amountMin) return [];
          if (input.amountMax !== undefined && Math.abs(amount) > input.amountMax) return [];
          return [{
            account: transaction.accountKey?.accountName ?? null,
            amount,
            category: categoryNameOf(transaction),
            currency: baseCurrency(viewer, context),
            date: transaction.transactionDate?.toISOString() ?? null,
            description: transaction.description ?? null,
            id: transaction.transactionKey,
          }];
        })
        .slice(0, input.limit);
      return result(
        { currency: baseCurrency(viewer, context), transactions: rows },
        { granularity: 'transactions', period: 'custom', recordCount: rows.length },
      );
    }, () => emptyResult({ currency: context.currency, transactions: [] }, 'transactions', 'custom'))),
];

export const AI_TOOL_NAMES = AI_TOOL_DEFINITIONS.map((definition) => definition.name);

interface BudgetStatus {
  budgeted: number;
  currency: string;
  period: string;
  recordCount: number;
  remaining: number;
  spent: number;
  status: 'active' | 'empty' | 'no_budget' | 'no_tenant_access';
}

async function budgetStatusFor(viewer: AiToolViewer, period: PeriodInput): Promise<BudgetStatus> {
  const now = new Date();
  const resolved = AiToolPeriodService.resolve(period, now);
  const currency = viewer.appuser.currencyKey.code || 'EUR';
  const budget = await DI.em.findOne(Budget, { deletedAt: undefined }, { orderBy: HOUSEHOLD_BUDGETS_FIRST, populate: ['currencyKey'] });
  if (!budget) {
    return { budgeted: 0, currency, period: resolved.key, recordCount: 0, remaining: 0, spent: 0, status: 'no_budget' };
  }
  const window = budgetWindow(budget, resolved, now);
  const budgetRows = await DI.em.find(BudgetTemplateCategory, {
    $or: window.months,
    budgetKey: budget,
    categoryKey: { deletedAt: undefined },
  }, { populate: ['categoryKey'] });
  const budgeted = budgetRows.reduce((sum, row) => sum + toNumber(row.amountBudgeted), 0);
  const budgetCategories = budgetRows.map((row) => row.categoryKey);
  const budgetCategoryKeys = new Set(budgetCategories.map((category) => category.categoryKey));
  const spendingLines = budgetCategories.length ? await findOwnSpendingLines(viewer, window) : [];
  const spent = spendingLines.reduce((sum, line) => (line.category && budgetCategoryKeys.has(line.category.categoryKey) ? sum + Math.abs(line.amount ?? 0) : sum), 0);
  return {
    budgeted,
    currency: budget.currencyKey.code || currency,
    period: resolved.key,
    recordCount: budgetRows.length,
    remaining: budgeted - spent,
    spent,
    status: budgetRows.length ? 'active' : 'empty',
  };
}

async function findScopedTransactions(viewer: AiToolViewer, period: { end: Date; start: Date }, options: { withCategories?: boolean } = {}) {
  // EXPIRED rows never moved money; PENDING still counts, as it always has here.
  return DI.em.find(Transaction, excludeExpired({
    accountKey: { closed: false, deletedAt: undefined },
    deletedAt: undefined,
    tenantKey: tenantRef(viewer),
    transactionDate: { $gte: period.start, $lte: period.end },
  }), { populate: options.withCategories ? [...CATEGORY_LINE_POPULATE, 'transactionTypeKey'] : ['reimbursedAmount', 'transactionTypeKey'] });
}

/** The member's own money-out rows in the period, with their category lines populated. */
async function findOwnSpendingTransactions(viewer: AiToolViewer, period: { end: Date; start: Date }) {
  return DI.em.find(Transaction, excludeExpired({
    accountKey: { closed: false, deletedAt: undefined },
    appuserKey: viewer.appuser,
    deletedAt: undefined,
    tenantKey: tenantRef(viewer),
    transactionDate: { $gte: period.start, $lte: period.end },
  }), { populate: [...CATEGORY_LINE_POPULATE, 'transactionTypeKey'] });
}

/**
 * The category lines (`category-lines.ts`) of the member's own spending in the period: money out,
 * no transfers, not expired, no line in a category that is not spending. A split transaction gives one line per split line, each with its
 * share; an unsplit one its single category (or none) for its whole amount.
 */
function categoryNameOf(transaction: Transaction): null | string {
  const category = transaction.appuserTransactionCategories.getItems()[0]?.categoryKey;
  return category?.name ?? null;
}

function endOfDay(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

async function findOwnSpendingLines(viewer: AiToolViewer, period: { end: Date; start: Date }) {
  const transactions = await findOwnSpendingTransactions(viewer, period);
  const spendingFlags = await loadCategorySpendingFlags(DI.em, viewer.tenant.tenantKey);
  return transactions.flatMap((transaction) => {
    if (isTransfer(transaction)) return [];
    const amount = getEffectiveAmount(transaction);
    return amount < 0 ? spendingLinesOf(transaction, amount, spendingFlags) : [];
  });
}

function getEffectiveAmount(transaction: TransactionLike): number {
  return toNumber(getEffectiveAppuserAmount(transaction));
}

/**
 * The budget months a period reads and the instants their spending is counted between (`end`
 * inclusive), in the budget's own months (`budget-period.ts`): "this month" is the budget month
 * today is in, which a start day after the 1st can move; a run of months ends with it. A period of
 * days keeps its days and reads the budget months they touch.
 */
function budgetWindow(budget: BudgetPeriodSettings, period: ReturnType<typeof AiToolPeriodService.resolve>, now: Date): { end: Date; months: BudgetMonth[]; start: Date } {
  const current = budgetMonthOf(budget, now);
  const span = (first: BudgetMonth, last: BudgetMonth) => {
    const months: BudgetMonth[] = [];
    for (let month = first; month.year * 12 + month.month <= last.year * 12 + last.month; month = shiftBudgetMonth(month, 1)) months.push(month);
    return months;
  };
  if (period.granularity === 'day') return { end: period.end, months: span(budgetMonthOf(budget, period.start), budgetMonthOf(budget, period.end)), start: period.start };
  const months = period.key === 'previous_month' ? [shiftBudgetMonth(current, -1)]
    : period.key === 'last_12_months' ? span(shiftBudgetMonth(current, -11), current)
      : period.key === 'year_to_date' ? span({ month: 1, year: current.year }, current)
        : [current];
  const first = months[0]!;
  const last = months.at(-1)!;
  const lastEnd = new Date(budgetPeriodRange(budget, last.year, last.month).end.getTime() - 1);
  // Year to date stops today, as the period does; a whole month runs to its last day.
  const end = period.key === 'year_to_date' && period.end < lastEnd ? period.end : lastEnd;
  return { end, months, start: budgetPeriodRange(budget, first.year, first.month).start };
}

function hasCategory(transaction: Transaction, categoryKey: number): boolean {
  return transaction.appuserTransactionCategories.getItems().some((link) => link.categoryKey.categoryKey === categoryKey);
}

function isTransfer(transaction: TransactionLike): boolean {
  const transactionType = transaction.transactionTypeKey;
  if (!transactionType) return false;
  const typeName = transactionType.name.toLowerCase();
  return typeName === 'transfer_in' || typeName === 'transfer_out' || typeName === 'transfer';
}

function startOfDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function tenantRef(viewer: AiToolViewer) {
  return getRef(DI.em, Tenant, viewer.tenant.tenantKey);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}
