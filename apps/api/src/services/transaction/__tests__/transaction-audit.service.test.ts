import type { EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';

import { TransactionAuditService } from '../transaction-audit.service';

function makeEm() {
  const flush = vi.fn().mockResolvedValue(undefined);
  const getReference = vi.fn((entity: unknown, id: unknown) => ({ entity, id }));
  const persist = vi.fn();
  const em = { flush, getReference, persist };
  persist.mockImplementation(() => em);
  return { em, flush, getReference, persist };
}

const baseInput = {
  actorType: TransactionAuditActorType.USER,
  appuserKey: 1,
  eventType: TransactionAuditEventType.CREATED,
  tenantKey: 7,
  transactionKey: 42,
};

describe('TransactionAuditService.log', () => {
  it('persists and flushes an audit row by default', async () => {
    const { em, flush, persist } = makeEm();
    const row = await TransactionAuditService.log(em as unknown as EntityManager, { ...baseInput, actorAppuserKey: 1, source: 'manual-transaction' });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(row).not.toBeNull();
    expect(row!.eventType).toBe(TransactionAuditEventType.CREATED);
    expect(row!.source).toBe('manual-transaction');
  });

  it('persists without flushing when { flush: false } (commits with the caller transaction)', async () => {
    const { em, flush, persist } = makeEm();
    await TransactionAuditService.log(em as unknown as EntityManager, baseInput, { flush: false });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();
  });

  it('drops non-allowlisted change fields so provider PII is never stored', async () => {
    const { em } = makeEm();
    const row = await TransactionAuditService.log(em as unknown as EntityManager, {
      ...baseInput,
      changes: {
        balance: { from: 10, to: 5 },
        iban: { from: 'SECRET-IBAN', to: 'OTHER-IBAN' },
        remittanceInformation: { from: 'x', to: 'y' },
      },
    });
    expect(row!.changes).toEqual({ balance: { from: 10, to: 5 } });
  });

  it('omits account/actor references when not supplied', async () => {
    const { em, getReference } = makeEm();
    const row = await TransactionAuditService.log(em as unknown as EntityManager, baseInput);
    // transaction + appuser + tenant only
    expect(getReference).toHaveBeenCalledTimes(3);
    expect(row!.accountKey).toBeUndefined();
    expect(row!.actorAppuserKey).toBeUndefined();
  });

  it('swallows write failures and returns null (never breaks the mutation)', async () => {
    const { em } = makeEm();
    em.persist = vi.fn(() => {
      throw new Error('db down');
    });
    const row = await TransactionAuditService.log(em as unknown as EntityManager, baseInput);
    expect(row).toBeNull();
  });
});

describe('TransactionAuditService.listDedupSkipped', () => {
  it('pins event_type=dedup_skipped, orders newest-first, and passes pagination through', async () => {
    const find = vi.fn().mockResolvedValue([]);
    await TransactionAuditService.listDedupSkipped({ find } as unknown as EntityManager, { limit: 25, offset: 50 });
    expect(find).toHaveBeenCalledTimes(1);
    const [, where, options] = find.mock.calls[0]!;
    expect(where).toEqual({ eventType: TransactionAuditEventType.DEDUP_SKIPPED });
    expect(options).toEqual({ limit: 25, offset: 50, orderBy: { createdAt: 'DESC', transactionAuditLogKey: 'DESC' } });
  });

  it('narrows by since (inclusive) and scope keys when supplied', async () => {
    const find = vi.fn().mockResolvedValue([]);
    const since = new Date('2026-07-01T00:00:00.000Z');
    await TransactionAuditService.listDedupSkipped({ find } as unknown as EntityManager, { accountKey: 3, appuserKey: 9, limit: 50, offset: 0, since, tenantKey: 7 });
    const [, where] = find.mock.calls[0]!;
    expect(where).toEqual({ accountKey: 3, appuserKey: 9, createdAt: { $gte: since }, eventType: TransactionAuditEventType.DEDUP_SKIPPED, tenantKey: 7 });
  });
});

describe('TransactionAuditService.listRemediations', () => {
  it('pins event_type=system_remediation and scopes by source (the remediation run/plan)', async () => {
    const find = vi.fn().mockResolvedValue([]);
    await TransactionAuditService.listRemediations({ find } as unknown as EntityManager, { limit: 50, offset: 0, source: 'rad346-phase3-backfill' });
    const [, where] = find.mock.calls[0]!;
    expect(where).toEqual({ eventType: TransactionAuditEventType.SYSTEM_REMEDIATION, source: 'rad346-phase3-backfill' });
  });
});
