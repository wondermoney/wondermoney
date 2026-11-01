/**
 * Ghost-pending expiry.
 *
 * A pending authorization can be dropped by the merchant and simply vanish from the feed without
 * ever posting. Left alone it lingers forever, making the transaction list (and available balance)
 * wrong. This planner finds pending rows that (a) are no longer present in the latest pending feed
 * and (b) are older than a grace window, so they can be moved to an `EXPIRED` status — hidden from
 * the default list, but auditable ("merchant dropped this hold") rather than silently deleted.
 *
 * Pure and conservative: a pending still present under any of its provider ids is kept, however old.
 */
import type { EntityManager } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import type { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import type { TransactionStatus } from '@entity/TransactionStatus';
import logger from '@utils/logger';

import { TransactionAuditService } from './transaction-audit.service';

/** Default grace period before a dropped pending is considered expired. */
export const DEFAULT_PENDING_GRACE_DAYS = 7;

export interface ExpirablePending {
  /** Provider identities on the stored row (nordigenInternalTransactionId, externalTransactionId). */
  identities: (null | string | undefined)[];
  transactionDate: Date;
  transactionKey: number;
}

export interface ExpiryOptions {
  /** Days a dropped pending is kept before it is considered expired. */
  graceDays: number;
  now: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function planPendingExpirations(pendings: ExpirablePending[], seenIdentities: Set<string>, options: ExpiryOptions): number[] {
  const cutoff = options.now.getTime() - options.graceDays * MS_PER_DAY;

  return pendings
    .filter((pending) => {
      const stillInFeed = pending.identities.some((id) => id != null && seenIdentities.has(id));
      if (stillInFeed) return false;
      return pending.transactionDate.getTime() < cutoff;
    })
    .map((pending) => pending.transactionKey);
}

/**
 * Dry-run ghost-pending expiry for one account during sync: find stored PENDING rows that dropped
 * out of the feed and are past the grace window, and record a `PENDING_EXPIRED` audit intent for
 * each — WITHOUT changing any status. Best-effort; never throws into the sync.
 */
export async function logDryRunExpirations(
  em: EntityManager,
  params: { account: Account; graceDays?: number; now?: Date; pendingStatus: TransactionStatus; seenIdentities: Set<string> },
): Promise<number[]> {
  try {
    // Hidden pendings too, as the live path (`applyExpirations`) reads them.
    const pendings = await em.find(Transaction, { accountKey: params.account, deletedAt: undefined, transactionStatusKey: params.pendingStatus }, { filters: { [HIDDEN_FILTER]: false } });
    if (pendings.length === 0) return [];

    const expirable = pendings.map((pending) => ({
      // `enableBankingTransactionId` too, as the live path (`applyExpirations`) does.
      identities: [pending.nordigenInternalTransactionId, pending.externalTransactionId, pending.enableBankingTransactionId],
      transactionDate: pending.transactionDate ?? new Date(0),
      transactionKey: pending.transactionKey,
    }));

    const keys = planPendingExpirations(expirable, params.seenIdentities, { graceDays: params.graceDays ?? DEFAULT_PENDING_GRACE_DAYS, now: params.now ?? new Date() });
    const pendingByKey = new Map(pendings.map((pending) => [pending.transactionKey, pending]));

    for (const key of keys) {
      const pending = pendingByKey.get(key);
      if (!pending) continue;
      await TransactionAuditService.log(em, {
        accountKey: params.account.accountKey,
        actorType: TransactionAuditActorType.SYNC,
        appuserKey: pending.appuserKey?.appuserKey ?? 0,
        changes: { transactionStatusKey: { from: 'PENDING', to: 'EXPIRED' } },
        eventType: TransactionAuditEventType.PENDING_EXPIRED,
        source: 'pending-expiry:dry-run',
        tenantKey: pending.tenantKey?.tenantKey ?? 0,
        transactionKey: key,
      });
    }

    if (keys.length > 0) logger.info({ accountKey: params.account.accountKey, expirations: keys.length }, 'Pending expiry (dry-run): intended expirations logged');
    return keys;
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : 'unknown' }, 'Pending expiry dry-run failed');
    return [];
  }
}
