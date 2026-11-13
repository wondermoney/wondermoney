import type { EntityManager } from '@mikro-orm/postgresql';

import { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';
import type { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { resolveAttributionChange, SHARED_MEMBER } from '@service/household/member-attribution';

import { TransactionAuditService } from './transaction-audit.service';

/** What a "Spent by" edit records for one side of the change: a member's key, `shared`, or null (the account's default). */
type StoredAttribution = null | number | typeof SHARED_MEMBER;

function storedAttributionOf(transaction: Pick<Transaction, 'attributedAppuserKey' | 'attributedToShared'>): StoredAttribution {
  const key = (transaction.attributedAppuserKey as null | undefined | { appuserKey: number })?.appuserKey;
  if (key != null) return key;
  return transaction.attributedToShared ? SHARED_MEMBER : null;
}

/**
 * "Spent by": attribute the transaction to a member of its household, to Shared, or (null) back to
 * its account's default. Attribution only (`member-attribution.ts`): who can see or change the row
 * is untouched. A member outside the household is a 400. Recorded in the transaction's history.
 */
export async function updateTransactionAttribution(
  em: EntityManager,
  actor: { appuser: Pick<Appuser, 'appuserKey'>; tenant: Pick<Tenant, 'tenantKey'> },
  transaction: Transaction,
  value: StoredAttribution,
): Promise<void> {
  const change = await resolveAttributionChange(em, actor.tenant.tenantKey, value);
  const previous = storedAttributionOf(transaction);
  const next: StoredAttribution = change.attributedAppuserKey ?? (change.attributedToShared ? SHARED_MEMBER : null);
  if (previous === next) return;

  transaction.attributedAppuserKey = change.attributedAppuserKey === null ? null : em.getReference(Appuser, { appuserKey: change.attributedAppuserKey } as unknown as Appuser);
  transaction.attributedToShared = change.attributedToShared;
  em.persist(transaction);
  await TransactionAuditService.log(em, {
    accountKey: transaction.accountKey?.accountKey ?? null,
    actorAppuserKey: actor.appuser.appuserKey,
    actorType: TransactionAuditActorType.USER,
    appuserKey: actor.appuser.appuserKey,
    changes: { attribution: { from: previous, to: next } },
    eventType: TransactionAuditEventType.USER_EDIT,
    source: 'transaction-attribution',
    tenantKey: actor.tenant.tenantKey,
    transactionKey: transaction.transactionKey,
  }, { flush: false });
  await em.flush();
}
