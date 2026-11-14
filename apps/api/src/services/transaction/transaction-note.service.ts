import type { EntityManager } from '@mikro-orm/postgresql';

import type { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';
import type { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';

export interface TransactionNoteActor {
  appuser: Appuser;
  tenant: Tenant;
}

/**
 * Set or clear the note on one transaction the member can see.
 *
 * The one implementation behind `PATCH /v1/account/transaction/:transactionId` with `notes` and an
 * applied `update_transaction_note` proposal. The note is trimmed and an empty one clears it, as
 * at creation. An unchanged note writes nothing. `auditSource` is the audit's `source`:
 * `user-edit` for the endpoint, `assistant-proposal` for a confirmed proposal.
 */
export async function updateTransactionNote(
  em: EntityManager,
  actor: TransactionNoteActor,
  transaction: Transaction,
  notes: null | string,
  options: { auditSource?: string } = {},
): Promise<void> {
  const next = notes?.trim() || undefined;
  const previous = transaction.notes ?? undefined;
  if (next === previous) return;

  transaction.notes = next;
  em.persist(transaction);
  await TransactionAuditService.log(em, {
    accountKey: transaction.accountKey?.accountKey ?? null,
    actorAppuserKey: actor.appuser.appuserKey,
    actorType: TransactionAuditActorType.USER,
    appuserKey: actor.appuser.appuserKey,
    changes: { notes: { from: previous ?? null, to: next ?? null } },
    eventType: TransactionAuditEventType.USER_EDIT,
    source: options.auditSource ?? 'user-edit',
    tenantKey: actor.tenant.tenantKey,
    transactionKey: transaction.transactionKey,
  }, { flush: false });
  await em.flush();
}
