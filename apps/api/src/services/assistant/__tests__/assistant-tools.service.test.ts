import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  em: {
    count: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    getReference: vi.fn((entity, id) => ({ entity, id })),
    persist: vi.fn().mockReturnThis(),
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

vi.mock('@app/app', () => ({
  DI: { em: mocked.em },
}));

vi.mock('../assistant-audit.service', () => ({
  AssistantAuditService: {
    log: mocked.log,
  },
}));

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

import { DEFAULT_ALLOWED_TOOLS } from '../assistant-policy.service';
import { AssistantToolsService } from '../assistant-tools.service';

interface CashflowTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: { inflow: number; net: number; outflow: number }; dataUsed: Record<string, unknown> }>;
}

describe('AssistantToolsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  afterEach(() => {
    delete process.env['ASSISTANT_ALLOWED_TOOLS'];
  });

  it('exposes approved v1 tool names', () => {
    expect(AssistantToolsService.getToolNames()).toEqual([...DEFAULT_ALLOWED_TOOLS]);
  });

  it('creates exactly the policy-approved tool map', () => {
    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });
    expect(Object.keys(tools)).toEqual([...DEFAULT_ALLOWED_TOOLS]);
  });

  it('creates only configured known tools when allowlist is restricted', () => {
    process.env['ASSISTANT_ALLOWED_TOOLS'] = 'get_cashflow_summary,get_all_transactions';

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });

    expect(Object.keys(tools)).toEqual(['get_cashflow_summary']);
  });

  it('does not expose unsafe tools', () => {
    expect(AssistantToolsService.getToolNames()).not.toEqual(expect.arrayContaining(['get_all_transactions', 'query_database']));
  });

  it('returns privacy-minimizing deterministic output without context identifiers', async () => {
    mocked.em.find.mockResolvedValueOnce([]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-secret', currency: 'EUR', tenantKey: 2 });
    const result = await (tools.get_cashflow_summary as unknown as CashflowTool).execute({ period: 'current_month' }, {});

    expect(JSON.stringify(result)).not.toContain('conversation-secret');
    expect(result).toEqual({ data: { currency: 'EUR', inflow: 0, net: 0, outflow: 0 }, dataUsed: { granularity: 'month', period: 'current_month', recordCount: 0, source: 'database' } });
  });

  it('logs tool execution with safe summary metadata', async () => {
    mocked.em.find.mockResolvedValueOnce([]);

    const tools = AssistantToolsService.createTools({ appuserKey: 99, consentVersion: 7, conversationId: 'conversation-7', currency: 'EUR', tenantKey: 42 });
    await (tools.get_cashflow_summary as unknown as CashflowTool).execute({ period: 'current_month' }, {});

    expect(mocked.log).toHaveBeenCalledWith(mocked.em, expect.objectContaining({
      appuserKey: 99,
      consentVersion: 7,
      conversationId: 'conversation-7',
      eventType: expect.any(String),
      metadata: expect.objectContaining({
        granularity: 'month',
        period: 'current_month',
        recordCount: 0,
        source: 'database',
        status: 'completed',
        toolName: 'get_cashflow_summary',
      }),
      tenantKey: 42,
      toolName: 'get_cashflow_summary',
    }));
    expect(JSON.stringify(mocked.log.mock.calls[0]?.[1] ?? {})).not.toContain('conversation-secret');
  });

  it('returns the same deterministic insights the home cards show', async () => {
    const insight = {
      facts: { baselineAmount: '100', categoryKey: 9, categoryKeys: [10], categoryName: 'Food', currency: 'EUR', currentAmount: '150', daysElapsed: 10, deviationPercent: '50.00', direction: 'above' as const, fromDate: '2026-11-01T00:00:00.000Z', toDate: '2026-11-10T12:00:00.000Z' },
      id: 'stable-id',
      period: '2026-11',
      severity: 'warning' as const,
      type: 'spending_vs_normal' as const,
    };
    mocked.services.insights.mockResolvedValueOnce({ insights: [insight] });

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });
    const result = await (tools.get_insights as unknown as { execute: (input: { month?: string }, options: unknown) => Promise<{ data: { currency: string; insights: unknown[] } }> }).execute({ month: '2026-11' }, {});

    expect(result.data).toEqual({ currency: 'EUR', insights: [insight] });
    expect(mocked.services.insights).toHaveBeenCalledWith(expect.objectContaining({ appuserKey: 1, currency: 'EUR', month: '2026-11', tenantKey: 2 }));
  });

  it('keeps filtered tools unavailable', () => {
    process.env['ASSISTANT_ALLOWED_TOOLS'] = 'get_cashflow_summary';

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', currency: 'EUR', tenantKey: 2 });

    expect(tools).not.toHaveProperty('query_database');
  });
});
