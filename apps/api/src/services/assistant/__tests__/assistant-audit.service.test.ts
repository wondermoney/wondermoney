import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { AssistantAuditEventType } from '@entity/AssistantAuditLog';

describe('AssistantAuditService', () => {
  it('persists audit metadata without assuming raw payload shape', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const getReference = vi.fn((entity, id) => ({ entity, id }));
    const em = {
      getReference,
      persist,
    } as unknown as EntityManager;

    const { AssistantAuditService } = await import('../assistant-audit.service');

    await AssistantAuditService.log(em, {
      appuserKey: 12,
      conversationId: 'conv_123',
      eventType: AssistantAuditEventType.TOOL_CALLED,
      metadata: { messages: 'raw prompt', recordCount: 3, status: 'completed' },
      tenantKey: 34,
      toolName: 'get_cashflow_summary',
    });

    expect(getReference).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        appuserKey: expect.objectContaining({ id: 12 }),
        conversationId: 'conv_123',
        eventType: AssistantAuditEventType.TOOL_CALLED,
        metadata: { recordCount: 3, status: 'completed' },
        tenantKey: expect.objectContaining({ id: 34 }),
        toolName: 'get_cashflow_summary',
      }),
    );
  });

  it('does not throw when audit persistence fails', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const getReference = vi.fn((entity, id) => ({ entity, id }));
    const em = {
      getReference,
      persist,
    } as unknown as EntityManager;

    const { AssistantAuditService } = await import('../assistant-audit.service');

    await expect(AssistantAuditService.log(em, {
      appuserKey: 12,
      conversationId: 'conv_123',
      eventType: AssistantAuditEventType.TOOL_CALLED,
      metadata: { status: 'completed' },
      tenantKey: 34,
      toolName: 'get_cashflow_summary',
    })).resolves.toBeNull();
  });
});
