import { startOfMonth } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addCategory, addPartner, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Goal, GoalType } from '@entity/Goal';
import type { AiToolContext, AiToolName } from '@service/ai-tools/ai-tool-types';
import { executeAiTool } from '@service/ai-tools/ai-tool-types';
import { AI_TOOL_DEFINITIONS } from '@service/ai-tools/ai-tools.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

const db = useTestDatabase();

async function runTool(name: AiToolName, input: unknown, context: AiToolContext) {
  const definition = AI_TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`No tool ${name}`);
  return executeAiTool(definition, input, context);
}

describe('shared read-only tools', () => {
  beforeEach(() => {
    DI.em = db.em();
  });

  async function seedTwoHouseholds() {
    const em = db.em();
    const a = await seedHousehold(em);
    const b = await seedHousehold(em);
    const partner = await addPartner(em, a);

    const shared = await addAccount(em, a, { appuserCurrencyBalance: 500, name: 'A shared' });
    const partnerPrivate = await addAccount(em, a, { appuserCurrencyBalance: 900, isPrivate: true, name: 'Partner private', owner: partner });
    const bAccount = await addAccount(em, b, { appuserCurrencyBalance: 700, name: 'B account' });

    const groceries = await addCategory(em, a, 'Groceries');
    const bCategory = await addCategory(em, b, 'B category');

    const now = new Date(startOfMonth(new Date()).getTime() + 12 * 60 * 60 * 1000);
    await addTransaction(em, a, { account: shared, amount: -20, category: groceries, date: now, status: 'BOOKED' });
    await addTransaction(em, a, { account: partnerPrivate, amount: -50, appuser: partner, date: now, status: 'BOOKED' });
    await addTransaction(em, b, { account: bAccount, amount: -30, date: now, status: 'BOOKED' });

    const budget = em.create(Budget, { appuserKey: a.appuser, currencyKey: a.currency, name: 'A budget', tenantKey: a.tenant }, { partial: true });
    await em.flush();
    em.create(BudgetTemplateCategory, { amountBudgeted: 100, budgetKey: budget, categoryKey: groceries, month: now.getMonth() + 1, year: now.getFullYear() }, { partial: true });
    em.create(Budget, { appuserKey: b.appuser, currencyKey: b.currency, name: 'B budget', tenantKey: b.tenant }, { partial: true });
    em.create(Goal, { appuserKey: a.appuser, currencyKey: a.currency, name: 'Holiday', targetAmount: 2000, tenantKey: a.tenant, type: GoalType.SAVE_UP }, { partial: true });
    await em.flush();

    return { a, b, bCategory, groceries, partner, partnerPrivate, shared };
  }

  const contextFor = (household: { appuser: { appuserKey: number }; tenant: { tenantKey: number } }): AiToolContext => ({
    appuserKey: household.appuser.appuserKey,
    currency: 'EUR',
    tenantKey: household.tenant.tenantKey,
  });

  it('lists only the accounts the caller may see, never another household\'s or a partner\'s private account', async () => {
    const { a, partner } = await seedTwoHouseholds();

    const owner = await runTool('list_accounts', {}, contextFor(a));
    const ownerNames = (owner.data as { accounts: { name: string }[] }).accounts.map((account) => account.name);
    expect(ownerNames).toContain('A shared');
    expect(ownerNames).not.toContain('Partner private');
    expect(ownerNames).not.toContain('B account');

    const partnerView = await runTool('list_accounts', {}, {
      appuserKey: partner.appuserKey,
      currency: 'EUR',
      tenantKey: a.tenant.tenantKey,
    });
    const partnerNames = (partnerView.data as { accounts: { name: string }[] }).accounts.map((account) => account.name);
    expect(partnerNames).toEqual(expect.arrayContaining(['A shared', 'Partner private']));
    expect(partnerNames).not.toContain('B account');
  });

  it('searches only the caller\'s visible transactions', async () => {
    const { a, partner } = await seedTwoHouseholds();

    const owner = await runTool('search_transactions', { limit: 100 }, contextFor(a));
    const ownerRows = (owner.data as { transactions: { amount: number }[] }).transactions;
    expect(ownerRows.map((row) => row.amount)).toEqual([-20]);

    const partnerView = await runTool('search_transactions', { limit: 100 }, {
      appuserKey: partner.appuserKey,
      currency: 'EUR',
      tenantKey: a.tenant.tenantKey,
    });
    const partnerRows = (partnerView.data as { transactions: { amount: number }[] }).transactions;
    expect(partnerRows.map((row) => row.amount).sort((left, right) => left - right)).toEqual([-50, -20]);
  });

  it('filters search results by amount and category', async () => {
    const { a, groceries } = await seedTwoHouseholds();

    const byAmount = await runTool('search_transactions', { amountMax: 25, limit: 100 }, contextFor(a));
    expect((byAmount.data as { transactions: unknown[] }).transactions).toHaveLength(1);

    const byCategory = await runTool('search_transactions', { categoryId: groceries.categoryKey, limit: 100 }, contextFor(a));
    expect((byCategory.data as { transactions: unknown[] }).transactions).toHaveLength(1);

    const otherCategory = await runTool('search_transactions', { categoryId: groceries.categoryKey + 999, limit: 100 }, contextFor(a));
    expect((otherCategory.data as { transactions: unknown[] }).transactions).toHaveLength(0);
  });

  it('values net worth without another household\'s or a private account', async () => {
    const { a, partner } = await seedTwoHouseholds();

    const owner = await runTool('get_net_worth_summary', {}, contextFor(a));
    expect(owner.data).toMatchObject({ netWorth: 1500 });

    const partnerView = await runTool('get_net_worth_summary', {}, {
      appuserKey: partner.appuserKey,
      currency: 'EUR',
      tenantKey: a.tenant.tenantKey,
    });
    expect(partnerView.data).toMatchObject({ netWorth: 2400 });
  });

  it('summarizes cashflow over the caller\'s visible accounts', async () => {
    const { a, partner } = await seedTwoHouseholds();

    const owner = await runTool('get_cashflow_summary', { period: 'current_month' }, contextFor(a));
    expect(owner.data).toMatchObject({ inflow: 0, net: -20, outflow: 20 });

    const partnerView = await runTool('get_cashflow_summary', { period: 'current_month' }, {
      appuserKey: partner.appuserKey,
      currency: 'EUR',
      tenantKey: a.tenant.tenantKey,
    });
    expect(partnerView.data).toMatchObject({ net: -70, outflow: 70 });
  });

  it('reports budget status and period comparison from the household budget', async () => {
    const { a } = await seedTwoHouseholds();

    const status = await runTool('get_budget_status', { period: 'current_month' }, contextFor(a));
    expect(status.data).toMatchObject({ budgeted: 100, currency: 'EUR', remaining: 80, spent: 20, status: 'active' });

    const comparison = await runTool('compare_budget_periods', {}, contextFor(a));
    const rows = (comparison.data as { comparison: { period: string; spent: number }[] }).comparison;
    expect(rows).toEqual([
      expect.objectContaining({ period: 'current_month', spent: 20 }),
      expect.objectContaining({ period: 'previous_month', spent: 0 }),
    ]);
  });

  it('reads the budget month today is in when the budget\'s month starts on a later day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    try {
      const em = db.em();
      const household = await seedHousehold(em);
      const groceries = await addCategory(em, household, 'Groceries');
      const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Payday', periodStartDay: 25, tenantKey: household.tenant }, { partial: true });
      em.create(BudgetTemplateCategory, { amountBudgeted: 100, budgetKey: budget, categoryKey: groceries, month: 11, year: 2026 }, { partial: true });
      em.create(BudgetTemplateCategory, { amountBudgeted: 300, budgetKey: budget, categoryKey: groceries, month: 12, year: 2026 }, { partial: true });
      await em.flush();
      // November's budget month ends on 24 November; December's starts on the 25th.
      await addTransaction(em, household, { amount: -10, category: groceries, date: new Date('2026-11-24T00:00:00Z'), status: 'BOOKED' });
      await addTransaction(em, household, { amount: -40, category: groceries, date: new Date('2026-11-25T00:00:00Z'), status: 'BOOKED' });

      const current = await runTool('get_budget_status', { period: 'current_month' }, contextFor(household));
      const previous = await runTool('get_budget_status', { period: 'previous_month' }, contextFor(household));

      expect(current.data).toMatchObject({ budgeted: 300, spent: 40 });
      expect(previous.data).toMatchObject({ budgeted: 100, spent: 10 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists only the household\'s budgets and categories', async () => {
    const { a } = await seedTwoHouseholds();

    const budgets = await runTool('list_budgets', {}, contextFor(a));
    expect((budgets.data as { budgets: { name: string }[] }).budgets.map((budget) => budget.name)).toEqual(['A budget']);

    const categories = await runTool('list_categories', {}, contextFor(a));
    const names = (categories.data as { categories: { name: string }[] }).categories.map((category) => category.name);
    expect(names).toContain('Groceries');
    expect(names).not.toContain('B category');
  });

  it('reports real goal progress', async () => {
    const { a } = await seedTwoHouseholds();

    const goals = await runTool('get_goal_progress_summary', {}, contextFor(a));
    expect(goals.data).toMatchObject({
      goals: [expect.objectContaining({ name: 'Holiday', progress: 0, targetAmount: 2000 })],
    });
  });

  it('reports real portfolio and income summaries, empty when there is no portfolio', async () => {
    const { a } = await seedTwoHouseholds();

    const portfolio = await runTool('get_portfolio_summary', {}, contextFor(a));
    expect(portfolio.data).toMatchObject({ portfolios: [], portfolioValue: 0 });

    const income = await runTool('get_portfolio_income_summary', {}, contextFor(a));
    expect(income.data).toMatchObject({ byAsset: [], total: 0 });
  });

  it('reports the largest transactions and the monthly spending trend', async () => {
    const { a } = await seedTwoHouseholds();

    const large = await runTool('get_large_transactions_summary', { period: 'current_month' }, contextFor(a));
    expect((large.data as { transactions: { amount: number }[] }).transactions).toEqual([
      expect.objectContaining({ amount: -20, category: 'Groceries' }),
    ]);

    const trend = await runTool('get_spending_trend', {}, contextFor(a));
    const points = (trend.data as { trend: { amount: number; month: string }[] }).trend;
    expect(points).toHaveLength(1);
    expect(points[0]?.amount).toBe(20);
  });

  it('returns an empty, currency-tagged answer when the caller has no household access', async () => {
    const { a } = await seedTwoHouseholds();

    const result = await runTool('get_budget_status', { period: 'current_month' }, { ...contextFor(a), tenantKey: 999_999 });
    expect(result.data).toMatchObject({ currency: 'EUR', status: 'no_tenant_access' });
  });
});
