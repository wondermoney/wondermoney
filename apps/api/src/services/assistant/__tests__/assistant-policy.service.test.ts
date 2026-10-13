import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AssistantPolicyService', () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env['ASSISTANT_ALLOWED_TOOLS'];
  });

  it('denies when assistant disabled', async () => {
    const { AssistantPolicyService } = await import('../assistant-policy.service');

    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: false, toolName: 'get_cashflow_summary' })).toEqual({
      allowed: false,
      reason: 'assistant_disabled',
    });
  });

  it('allows approved tool when enabled', async () => {
    const { AssistantPolicyService } = await import('../assistant-policy.service');

    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName: 'get_cashflow_summary' })).toEqual({
      allowed: true,
    });
  });

  it('denies unknown tool', async () => {
    const { AssistantPolicyService } = await import('../assistant-policy.service');

    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName: 'get_all_transactions' })).toEqual({
      allowed: false,
      reason: 'tool_not_allowed',
    });
  });

  it('uses configured allowed tools when set', async () => {
    process.env['ASSISTANT_ALLOWED_TOOLS'] = 'get_cashflow_summary';
    const { AssistantPolicyService } = await import('../assistant-policy.service');

    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName: 'get_cashflow_summary' })).toEqual({ allowed: true });
    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName: 'get_budget_status' })).toEqual({
      allowed: false,
      reason: 'tool_not_allowed',
    });
  });

  it('denies all tools when allowed tools env is set but empty', async () => {
    process.env['ASSISTANT_ALLOWED_TOOLS'] = ' , ';
    const { AssistantPolicyService } = await import('../assistant-policy.service');

    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName: 'get_cashflow_summary' })).toEqual({
      allowed: false,
      reason: 'tool_not_allowed',
    });
  });

  it('does not allow unknown tools through env configuration', async () => {
    process.env['ASSISTANT_ALLOWED_TOOLS'] = 'get_cashflow_summary,get_all_transactions';
    const { AssistantPolicyService } = await import('../assistant-policy.service');

    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName: 'get_cashflow_summary' })).toEqual({ allowed: true });
    expect(AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName: 'get_all_transactions' })).toEqual({
      allowed: false,
      reason: 'tool_not_allowed',
    });
  });
});
