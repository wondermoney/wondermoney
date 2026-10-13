import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  em: { find: vi.fn(), findOne: vi.fn(), getReference: vi.fn((entity, id) => ({ entity, id })) },
}));

vi.mock('@app/app', () => ({ DI: { em: mocked.em } }));

import { AssistantToolsService } from '../assistant-tools.service';

interface BudgetStatusTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: { status: string }; dataUsed: Record<string, unknown> }>;
}

interface CashflowTool {
  execute: (input: { period: 'current_month' }, options: unknown) => Promise<{ data: { inflow: number; net: number; outflow: number }; dataUsed: Record<string, unknown> }>;
}

describe('AssistantToolsService integration shape', () => {
  it('redacts deterministic cashflow output and omits unsafe identifiers', async () => {
    mocked.em.find.mockResolvedValueOnce([
      { appuserSettlementAmount: 120, transactionTypeKey: { name: 'income' } },
      { appuserSettlementAmount: -150, transactionTypeKey: { name: 'card_payment' } },
      { appuserSettlementAmount: -999, transactionTypeKey: { name: 'transfer_out' } },
    ]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', tenantKey: 2 });
    const result = await (tools.get_cashflow_summary as unknown as CashflowTool).execute({ period: 'current_month' }, {});

    expect(JSON.stringify(result)).not.toContain('tenantKey');
    expect(JSON.stringify(result)).not.toContain('appuserKey');
    expect(JSON.stringify(result)).not.toContain('conversationId');
    expect(result).toEqual({ data: { inflow: 120, net: -30, outflow: 150 }, dataUsed: { granularity: 'month', period: 'current_month', recordCount: 2, source: 'database' } });
  });

  it('does not mix non-user-currency fallback amounts into cashflow totals', async () => {
    mocked.em.find.mockResolvedValueOnce([
      { appuserSettlementAmount: undefined, originalAmount: 999, settlementAmount: 999, transactionTypeKey: { name: 'card_payment' } },
      { appuserSettlementAmount: '-50', originalAmount: -999, settlementAmount: -999, transactionTypeKey: { name: 'card_payment' } },
    ]);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', tenantKey: 2 });
    const result = await (tools.get_cashflow_summary as unknown as CashflowTool).execute({ period: 'current_month' }, {});

    expect(result.data).toEqual({ inflow: 0, net: -50, outflow: 50 });
  });

  it('checks tenant membership before reading budget data', async () => {
    mocked.em.findOne.mockResolvedValueOnce(null);

    const tools = AssistantToolsService.createTools({ appuserKey: 1, consentVersion: 1, conversationId: 'conversation-1', tenantKey: 2 });
    const result = await (tools.get_budget_status as unknown as BudgetStatusTool).execute({ period: 'current_month' }, {});

    expect(mocked.em.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recordActive: true }));
    expect(result.data.status).toBe('no_tenant_access');
  });
});
