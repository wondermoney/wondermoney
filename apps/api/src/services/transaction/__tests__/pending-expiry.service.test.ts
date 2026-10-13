import type { EntityManager } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from '@entity/Account';
import { TransactionAuditEventType } from '@entity/TransactionAuditLog';
import type { TransactionStatus } from '@entity/TransactionStatus';

import { logDryRunExpirations, planPendingExpirations } from '../pending-expiry.service';
import { TransactionAuditService } from '../transaction-audit.service';

const NOW = new Date('2026-07-31T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

describe('planPendingExpirations', () => {
  it('expires a pending that dropped out of the feed and is older than the grace window', () => {
    const keys = planPendingExpirations(
      [{ identities: ['nord-1'], transactionDate: daysAgo(10), transactionKey: 5 }],
      new Set(['nord-2']),
      { graceDays: 7, now: NOW },
    );
    expect(keys).toEqual([5]);
  });

  it('keeps a pending still present in the latest feed, however old', () => {
    const keys = planPendingExpirations(
      [{ identities: ['nord-1'], transactionDate: daysAgo(30), transactionKey: 5 }],
      new Set(['nord-1']),
      { graceDays: 7, now: NOW },
    );
    expect(keys).toEqual([]);
  });

  it('keeps a dropped pending that is still within the grace window', () => {
    const keys = planPendingExpirations(
      [{ identities: ['nord-1'], transactionDate: daysAgo(3), transactionKey: 5 }],
      new Set(),
      { graceDays: 7, now: NOW },
    );
    expect(keys).toEqual([]);
  });

  it('expires a pending with no provider identity once past the grace window (it can never be in the feed)', () => {
    const keys = planPendingExpirations(
      [{ identities: [null, undefined], transactionDate: daysAgo(10), transactionKey: 9 }],
      new Set(['nord-1']),
      { graceDays: 7, now: NOW },
    );
    expect(keys).toEqual([9]);
  });

  it('matches on any identity — present under either provider id keeps it alive', () => {
    const keys = planPendingExpirations(
      [{ identities: ['ext-1', 'nord-1'], transactionDate: daysAgo(30), transactionKey: 5 }],
      new Set(['ext-1']),
      { graceDays: 7, now: NOW },
    );
    expect(keys).toEqual([]);
  });
});

describe('logDryRunExpirations', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('logs a PENDING_EXPIRED intent for a dropped, past-grace pending without changing its status', async () => {
    const auditSpy = vi.spyOn(TransactionAuditService, 'log').mockResolvedValue(null);
    const stored = {
      appuserKey: { appuserKey: 9 },
      externalTransactionId: 'ext-1',
      nordigenInternalTransactionId: 'nord-1',
      tenantKey: { tenantKey: 3 },
      transactionDate: daysAgo(20),
      transactionKey: 5,
    };
    const em = { find: vi.fn().mockResolvedValue([stored]) };

    const keys = await logDryRunExpirations(em as unknown as EntityManager, {
      account: { accountKey: 5 } as unknown as Account,
      now: NOW,
      pendingStatus: {} as unknown as TransactionStatus,
      seenIdentities: new Set(['nord-999']), // stored pending is NOT in the latest feed
    });

    expect(keys).toEqual([5]);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]?.[1]).toMatchObject({ eventType: TransactionAuditEventType.PENDING_EXPIRED, transactionKey: 5 });
  });

  it('never throws and returns [] when the pending lookup fails', async () => {
    const em = { find: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(
      logDryRunExpirations(em as unknown as EntityManager, { account: { accountKey: 5 } as unknown as Account, pendingStatus: {} as unknown as TransactionStatus, seenIdentities: new Set() }),
    ).resolves.toEqual([]);
  });
});
