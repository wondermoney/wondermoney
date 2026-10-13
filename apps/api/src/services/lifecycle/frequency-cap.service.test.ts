import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it } from 'vitest';

import { isSendAllowed, loadSendWindow } from '@service/lifecycle/frequency-cap.service';

describe('isSendAllowed', () => {
  it('blocks when a critical thread is active (beats numeric caps)', () => {
    expect(isSendAllowed({ criticalThreadActive: true, last7dCount: 0, last24hCount: 0 })).toEqual({ allowed: false, reason: 'critical_thread' });
  });

  it('blocks a second send within 24h', () => {
    expect(isSendAllowed({ criticalThreadActive: false, last7dCount: 1, last24hCount: 1 })).toEqual({ allowed: false, reason: 'cap_24h' });
  });

  it('blocks the 4th send within 7 days', () => {
    expect(isSendAllowed({ criticalThreadActive: false, last7dCount: 3, last24hCount: 0 })).toEqual({ allowed: false, reason: 'cap_7d' });
  });

  it('allows when under all limits and no critical thread', () => {
    expect(isSendAllowed({ criticalThreadActive: false, last7dCount: 2, last24hCount: 0 })).toEqual({ allowed: true });
  });
});

describe('loadSendWindow', () => {
  const em = { count: async () => 2 } as unknown as EntityManager;

  it('reads sent counts and passes through the injected critical-thread flag', async () => {
    const w = await loadSendWindow(em, 1, new Date('2026-07-28T09:00:00Z'), async () => true);
    expect(w).toEqual({ criticalThreadActive: true, last7dCount: 2, last24hCount: 2 });
  });

  it('defaults critical-thread to false when no checker is supplied', async () => {
    const w = await loadSendWindow(em, 1, new Date('2026-07-28T09:00:00Z'));
    expect(w.criticalThreadActive).toBe(false);
  });
});
