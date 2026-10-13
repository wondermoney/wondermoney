import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it } from 'vitest';

import { SupportedLanguages } from '@entity/Appuser';
import { LifecycleDelivery } from '@entity/LifecycleDelivery';
import { cancelPending, markSent, markSuppressed, upsertPendingDelivery } from '@service/lifecycle/lifecycle-delivery.service';
import { LifecycleCampaign, LifecycleDeliveryStatus } from '@service/lifecycle/lifecycle-types';

/**
 * Lightweight in-memory EntityManager fake — enough to exercise the branching
 * (idempotent upsert, targeted cancel) without a live database.
 */
function fakeEm(): { em: EntityManager; rows: LifecycleDelivery[] } {
  const rows: LifecycleDelivery[] = [];
  const matches = (r: LifecycleDelivery, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      const rv = (r as unknown as Record<string, unknown>)[k];
      if (v !== null && typeof v === 'object' && '$in' in (v)) return (v as { $in: unknown[] }).$in.includes(rv);
      return rv === v;
    });
  const em = {
    create: (_e: unknown, data: Record<string, unknown>) => ({ lifecycleDeliveryKey: rows.length + 1, ...data }) as unknown as LifecycleDelivery,
    find: async (_e: unknown, where: Record<string, unknown>) => rows.filter((r) => matches(r, where)),
    findOne: async (_e: unknown, where: Record<string, unknown>) => rows.find((r) => matches(r, where)) ?? null,
    flush: async () => undefined,
    persist: (row: LifecycleDelivery) => { rows.push(row); return { flush: async () => undefined }; },
    remove: (row: LifecycleDelivery) => { const i = rows.indexOf(row); if (i >= 0) rows.splice(i, 1); },
  } as unknown as EntityManager;
  return { em, rows };
}

describe('upsertPendingDelivery', () => {
  it('is idempotent on (user, campaign, step)', async () => {
    const { em } = fakeEm();
    const a = await upsertPendingDelivery(em, { appuserKey: 1, campaign: LifecycleCampaign.DATA_HEALTH, scheduledFor: new Date('2026-07-28T09:00:00Z'), step: 'consent_expiring', templateVersion: 'data-health.v1' });
    const b = await upsertPendingDelivery(em, { appuserKey: 1, campaign: LifecycleCampaign.DATA_HEALTH, scheduledFor: new Date('2026-07-28T10:00:00Z'), step: 'consent_expiring', templateVersion: 'data-health.v1' });
    expect(b.lifecycleDeliveryKey).toBe(a.lifecycleDeliveryKey);
  });

  it('creates distinct rows for different steps', async () => {
    const { em, rows } = fakeEm();
    await upsertPendingDelivery(em, { appuserKey: 1, campaign: LifecycleCampaign.DATA_HEALTH, scheduledFor: new Date(), step: 'consent_expiring', templateVersion: 'data-health.v1' });
    await upsertPendingDelivery(em, { appuserKey: 1, campaign: LifecycleCampaign.DATA_HEALTH, scheduledFor: new Date(), step: 'reconnect_reminder', templateVersion: 'data-health.v1' });
    expect(rows).toHaveLength(2);
  });
});

describe('cancelPending', () => {
  it('removes not-yet-sent rescue rows and leaves sent rows', async () => {
    const { em, rows } = fakeEm();
    await upsertPendingDelivery(em, { appuserKey: 2, campaign: LifecycleCampaign.DATA_HEALTH, scheduledFor: new Date(), step: 'reconnect_reminder', templateVersion: 'data-health.v1' });
    const welcome = await upsertPendingDelivery(em, { appuserKey: 2, campaign: LifecycleCampaign.DATA_HEALTH, scheduledFor: new Date(), step: 'consent_expiring', templateVersion: 'data-health.v1' });
    markSent(welcome, 'msg_abc', SupportedLanguages.EN);
    const n = await cancelPending(em, 2, LifecycleCampaign.DATA_HEALTH, ['reconnect_reminder', 'reconnect_final']);
    expect(n).toBe(1);
    expect(rows.map((r) => r.step)).toEqual(['consent_expiring']);
  });
});

describe('markSent / markSuppressed', () => {
  it('markSent stamps provider id, language, sent/completed timestamps', () => {
    const d = { status: LifecycleDeliveryStatus.PENDING } as LifecycleDelivery;
    markSent(d, 'msg_1', SupportedLanguages.PT);
    expect(d.status).toBe(LifecycleDeliveryStatus.SENT);
    expect(d.providerMessageId).toBe('msg_1');
    expect(d.languageAtSend).toBe('PT');
    expect(d.sentAt).toBeInstanceOf(Date);
    expect(d.completedAt).toBeInstanceOf(Date);
  });

  it('markSuppressed records the reason and completes without sending', () => {
    const d = { status: LifecycleDeliveryStatus.PENDING } as LifecycleDelivery;
    markSuppressed(d, 'not_eligible');
    expect(d.status).toBe(LifecycleDeliveryStatus.SUPPRESSED);
    expect(d.outcomeCode).toBe('not_eligible');
    expect(d.sentAt).toBeUndefined();
    expect(d.completedAt).toBeInstanceOf(Date);
  });
});
