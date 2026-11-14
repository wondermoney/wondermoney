import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  em: {
    find: vi.fn(),
    findOne: vi.fn(),
    getConnection: vi.fn(() => ({ execute: vi.fn().mockResolvedValue([]) })),
    getReference: vi.fn((entity, id) => ({ entity, id })),
  },
  log: vi.fn(),
  services: {
    dividendIncome: vi.fn(),
    insights: vi.fn(),
    listGoals: vi.fn(),
    netWorth: vi.fn(),
    portfolioDashboard: vi.fn(),
    recurringSchedule: vi.fn(),
    viewerAmounts: vi.fn(),
  },
  viewer: vi.fn(),
}));

vi.mock('@app/app', () => ({ DI: { em: mocked.em } }));
vi.mock('../assistant-audit.service', () => ({ AssistantAuditService: { log: mocked.log } }));
vi.mock('@service/ai-tools/ai-tool-viewer', () => ({ loadAiToolViewer: mocked.viewer }));
vi.mock('@service/insights/insights.service', () => ({
  InsightsService: class {
    getInsights(input: unknown) {
      return mocked.services.insights(input) as Promise<unknown>;
    }
  },
}));
vi.mock('@service/net-worth/net-worth.service', () => ({ default: { getNetWorth: mocked.services.netWorth } }));
vi.mock('@service/portfolio/portfolio-dashboard.service', () => ({ default: { getAggregateDashboard: mocked.services.portfolioDashboard } }));
vi.mock('@service/portfolio/portfolio-holdings.service', () => ({ default: { getDividendIncome: mocked.services.dividendIncome } }));
vi.mock('@service/goal/goal.service', () => ({
  GoalService: class {
    listGoals(input: unknown) {
      return mocked.services.listGoals(input) as Promise<unknown>;
    }
  },
}));
vi.mock('@service/recurring/recurring-schedule.service', () => ({ loadRecurringSchedule: mocked.services.recurringSchedule }));
vi.mock('@service/reports/report-currency', () => ({ loadViewerCurrencyAmounts: mocked.services.viewerAmounts }));

import { AssistantToolsService } from '../assistant-tools.service';

interface BudgetStatusTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: { status: string }; dataUsed: Record<string, unknown> }>;
}

interface CashflowTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: { inflow: number; net: number; outflow: number }; dataUsed: Record<string, unknown> }>;
}

describe('AssistantToolsService integration shape', () => {
  beforeEach(() => {
    mocked.viewer.mockImplementation((context: { appuserKey: number; currency: string; tenantKey: number }) =>
      Promise.resolve({
        appuser: { appuserKey: context.appuserKey, currencyKey: { code: context.currency } },
        tenant: { tenantKey: context.tenantKey },
      }),
    );
    mocked.services.insights.mockResolvedValue({ insights: [] });
    mocked.services.netWorth.mockResolvedValue({
      assets: { accounts: 0, manualAssets: 0, portfolios: 0 },
      currencyCode: 'EUR',
      isComplete: true,
      liabilities: { loans: 0 },
      rows: [],
      totalNetWorth: 0,
    });
    mocked.services.portfolioDashboard.mockResolvedValue({
      portfolios: [],
      summary: { currency: 'EUR', totalGainLoss: 0, totalGainLossPercent: 0, totalValue: 0 },
    });
    mocked.services.dividendIncome.mockResolvedValue({ byAsset: [], completeness: { currencyCode: 'EUR' }, totalDividends: 0 });
    mocked.services.listGoals.mockResolvedValue([]);
    mocked.services.recurringSchedule.mockResolvedValue([]);
    mocked.services.viewerAmounts.mockResolvedValue({ amountOf: () => null });
  });

  it('redacts deterministic cashflow output and omits unsafe identifiers', async () => {
    mocked.em.find.mockResolvedValueOnce([
      { appuserSettlementAmount: 120, transactionTypeKey: { name: 'income' } },
      { appuserSettlementAmount: -150, transactionTypeKey: { name: 'card_payment' } },
      { appuserSettlementAmount: -999, transactionTypeKey: { name: 'transfer_out' } },
    ]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });
    const result = await (tools.get_cashflow_summary as unknown as CashflowTool).execute({ period: 'current_month' }, {});

    expect(JSON.stringify(result)).not.toContain('tenantKey');
    expect(JSON.stringify(result)).not.toContain('appuserKey');
    expect(JSON.stringify(result)).not.toContain('conversationId');
    expect(result).toEqual({ data: { currency: 'EUR', inflow: 120, net: -30, outflow: 150 }, dataUsed: { granularity: 'month', period: 'current_month', recordCount: 2, source: 'database' } });
  });

  it('does not mix non-user-currency fallback amounts into cashflow totals', async () => {
    mocked.em.find.mockResolvedValueOnce([
      { appuserSettlementAmount: undefined, originalAmount: 999, settlementAmount: 999, transactionTypeKey: { name: 'card_payment' } },
      { appuserSettlementAmount: '-50', originalAmount: -999, settlementAmount: -999, transactionTypeKey: { name: 'card_payment' } },
    ]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });
    const result = await (tools.get_cashflow_summary as unknown as CashflowTool).execute({ period: 'current_month' }, {});

    expect(result.data).toEqual({ currency: 'EUR', inflow: 0, net: -50, outflow: 50 });
  });

  it('answers no_tenant_access when the caller has no household access', async () => {
    mocked.viewer.mockResolvedValueOnce(null);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });
    const result = await (tools.get_budget_status as unknown as BudgetStatusTool).execute({ period: 'current_month' }, {});

    expect(result.data.status).toBe('no_tenant_access');
  });

  /*
   * A bare number reads as dollars to the model, so a EUR user saw "$1,234.56"
   *. Every amount a tool hands the model has to say what currency it is in.
   */
  it('names the currency of every tool result', async () => {
    mocked.em.find.mockResolvedValue([]);
    mocked.em.findOne.mockResolvedValue(null);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });

    // The propose_* tools hand back a proposal, never an amount.
    for (const [name, candidate] of Object.entries(tools).filter(([toolName]) => !toolName.startsWith('propose_'))) {
      const result = await (candidate as unknown as AnyTool).execute({ period: 'current_month' }, {});
      expect({ currency: result.data['currency'], name }).toEqual({ currency: 'EUR', name });
    }
  });

  it('reports spending by category in the base currency', async () => {
    mocked.em.find.mockResolvedValueOnce([
      { appuserSettlementAmount: -40, appuserTransactionCategories: { getItems: () => [{ categoryKey: { name: 'Groceries' } }] }, transactionTypeKey: { name: 'card_payment' } },
    ]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });
    const result = await (tools.get_spending_by_category as unknown as AnyTool).execute({ period: 'current_month' }, {});

    expect(result.data).toEqual({ categories: [{ amount: 40, category: 'Groceries' }], currency: 'EUR' });
  });

  it('reports budget status in the budget\'s own currency', async () => {
    mocked.em.findOne.mockResolvedValueOnce({ currencyKey: { code: 'GBP' }, periodStartDay: 1 });
    mocked.em.find.mockResolvedValueOnce([]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });
    const result = await (tools.get_budget_status as unknown as AnyTool).execute({ period: 'current_month' }, {});

    expect(result.data).toMatchObject({ currency: 'GBP', status: 'empty' });
  });
});

interface AnyTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: Record<string, unknown>; dataUsed: Record<string, unknown> }>;
}
