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
}));

vi.mock('@app/app', () => ({
  DI: { em: mocked.em },
}));

vi.mock('../assistant-audit.service', () => ({
  AssistantAuditService: {
    log: mocked.log,
  },
}));

import { DEFAULT_ALLOWED_TOOLS } from '../assistant-policy.service';
import { AssistantToolsService } from '../assistant-tools.service';

interface CashflowTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: { inflow: number; net: number; outflow: number }; dataUsed: Record<string, unknown> }>;
}

describe('AssistantToolsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env['ASSISTANT_ALLOWED_TOOLS'];
  });

  it('exposes approved v1 tool names', () => {
    expect(AssistantToolsService.getToolNames()).toEqual([...DEFAULT_ALLOWED_TOOLS]);
  });

  it('creates exactly the policy-approved tool map', () => {
    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', tenantKey: 2 });
    expect(Object.keys(tools)).toEqual([...DEFAULT_ALLOWED_TOOLS]);
  });

  it('creates only configured known tools when allowlist is restricted', () => {
    process.env['ASSISTANT_ALLOWED_TOOLS'] = 'get_cashflow_summary,get_all_transactions';

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', tenantKey: 2 });

    expect(Object.keys(tools)).toEqual(['get_cashflow_summary']);
  });

  it('does not expose unsafe tools', () => {
    expect(AssistantToolsService.getToolNames()).not.toEqual(expect.arrayContaining(['get_all_transactions', 'query_database']));
  });

  it('returns privacy-minimizing deterministic output without context identifiers', async () => {
    mocked.em.find.mockResolvedValueOnce([]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-secret', tenantKey: 2 });
    const result = await (tools.get_cashflow_summary as unknown as CashflowTool).execute({ period: 'current_month' }, {});

    expect(JSON.stringify(result)).not.toContain('conversation-secret');
    expect(result).toEqual({ data: { inflow: 0, net: 0, outflow: 0 }, dataUsed: { granularity: 'month', period: 'current_month', recordCount: 0, source: 'database' } });
  });

  it('logs tool execution with safe summary metadata', async () => {
    mocked.em.find.mockResolvedValueOnce([]);

    const tools = AssistantToolsService.createTools({ appuserKey: 99, consentVersion: 7, conversationId: 'conversation-7', tenantKey: 42 });
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

  it('keeps filtered tools unavailable', () => {
    process.env['ASSISTANT_ALLOWED_TOOLS'] = 'get_cashflow_summary';

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', tenantKey: 2 });

    expect(tools).not.toHaveProperty('query_database');
  });
});
