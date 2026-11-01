import { startOfMonth } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

import { addCategory, addTransaction, ONE_OF_EACH_STATUS, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../assistant-audit.service', () => ({ AssistantAuditService: { log: vi.fn() } }));

import { AssistantToolsService } from '../assistant-tools.service';

interface AnyTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: Record<string, unknown> }>;
}

/*
 * An EXPIRED row is money that never moved: a pending authorisation that dropped out of the feed,
 * or a payment the bank rejected or cancelled. The assistant must not report it as spending.
 * PENDING still counts here, as it did before: it is money already committed.
 */
describe('assistant tools and transaction status', () => {
  const db = useTestDatabase();
  const inThisMonth = () => new Date(startOfMonth(new Date()).getTime() + 12 * 60 * 60 * 1000);

  async function seedSpending() {
    const em = db.em();
    const household = await seedHousehold(em);
    const groceries = await addCategory(em, household, 'Groceries');
    for (const status of ONE_OF_EACH_STATUS) {
      await addTransaction(em, household, { amount: -10, category: groceries, date: inThisMonth(), status });
    }
    return { em, groceries, household };
  }

  function toolsFor(household: Awaited<ReturnType<typeof seedHousehold>>) {
    const tools = AssistantToolsService.createTools({ appuserKey: household.appuser.appuserKey, consentVersion: 1, conversationId: 'c-1', currency: 'EUR', tenantKey: household.tenant.tenantKey }) as unknown as Record<string, AnyTool | undefined>;
    return (name: string): AnyTool => {
      const found = tools[name];
      if (!found) throw new Error(`no tool ${name}`);
      return found;
    };
  }

  it('leaves expired rows out of the cashflow summary', async () => {
    const { household } = await seedSpending();

    const result = await toolsFor(household)('get_cashflow_summary').execute({ period: 'current_month' }, {});

    expect(result.data).toMatchObject({ inflow: 0, net: -30, outflow: 30 });
  });

  it('leaves expired rows out of spending by category', async () => {
    const { household } = await seedSpending();

    const result = await toolsFor(household)('get_spending_by_category').execute({ period: 'current_month' }, {});

    expect(result.data['categories']).toEqual([{ amount: 30, category: 'Groceries' }]);
  });

  it('leaves expired rows out of budget status spending', async () => {
    const { em, groceries, household } = await seedSpending();
    const now = inThisMonth();
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    em.create(BudgetTemplateCategory, { amountBudgeted: 100, budgetKey: budget, categoryKey: groceries, month: now.getMonth() + 1, year: now.getFullYear() }, { partial: true });
    await em.flush();

    const result = await toolsFor(household)('get_budget_status').execute({ period: 'current_month' }, {});

    expect(result.data).toMatchObject({ budgeted: 100, remaining: 70, spent: 30 });
  });
});
