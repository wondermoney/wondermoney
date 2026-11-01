import type { Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { Account } from './Account';
import { Appuser } from './Appuser';
import { Base } from './BaseEntity';
import { Tenant } from './Tenant';
import { Transaction } from './Transaction';

export enum TransactionAuditActorType {
  AI = 'ai',
  SYNC = 'sync',
  SYSTEM = 'system',
  USER = 'user',
}

export enum TransactionAuditEventType {
  BALANCE_RECALC = 'balance_recalc',
  CATEGORIZED = 'categorized',
  CREATED = 'created',
  /** A possible duplicate was detected on a user/CSV entry but the row was still created
   * (warn-and-allow). Distinct from `DEDUP_SKIPPED`, where the incoming row was NOT created — mixing
   * the two would corrupt the dedup skip-rate signal. The flagged-against row is recorded
   * in `changes.flaggedAgainstTransactionKey`. */
  DEDUP_FLAGGED = 'dedup_flagged',
  DEDUP_SKIPPED = 'dedup_skipped',
  PENDING_EXPIRED = 'pending_expired',
  PENDING_PROMOTED = 'pending_promoted',
  SOFT_DELETED = 'soft_deleted',
  SYSTEM_EDIT = 'system_edit',
  /** A row was soft-deleted by an operator-driven remediation (e.g. dedup backfill).
   * Pairs with `SOFT_DELETED` (which is a user-initiated delete from the UI). */
  SYSTEM_REMEDIATION = 'system_remediation',
  USER_EDIT = 'user_edit',
}

/**
 * Append-only audit trail for transaction changes.
 *
 * One row per meaningful mutation (create, user edit, categorization, sync-driven
 * promotions/dedup). Written via explicit `TransactionAuditService.log`
 * calls at each mutation site so the actor (who/why) can be attributed; there is no
 * ORM-subscriber fallback yet. Rows are never updated or deleted through the app.
 */
@Entity({ tableName: 'transaction_audit_log' })
@Index({ name: 'transaction_audit_log_transaction_key_created_at_index', properties: ['transactionKey', 'createdAt'] })
@Index({ name: 'transaction_audit_log_tenant_key_appuser_key_created_at_index', properties: ['tenantKey', 'appuserKey', 'createdAt'] })
export class TransactionAuditLog extends Base {
  @ManyToOne({ cascade: [], entity: () => Account, fieldName: 'account_key', nullable: true })
  accountKey?: Rel<Account>;

  /** The appuser that made the change. Null for non-user (system/sync/AI) events. */
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'actor_appuser_key', nullable: true })
  actorAppuserKey?: Rel<Appuser>;

  @Enum(() => TransactionAuditActorType)
  actorType!: TransactionAuditActorType;

  /** The owning appuser of the transaction (for scoping history queries). */
  @ManyToOne({ cascade: [], entity: () => Appuser, fieldName: 'appuser_key' })
  appuserKey!: Rel<Appuser>;

  /** Allowlisted `{ field: { from, to } }` diff of money/meaning fields. No raw provider PII. */
  @Property({ columnType: 'jsonb', nullable: true })
  changes?: Record<string, { from: unknown; to: unknown }>;

  @Enum(() => TransactionAuditEventType)
  eventType!: TransactionAuditEventType;

  /** Free-text origin of the change, e.g. `manual-transaction`, `transaction-amount-edit`, `bulk-update`. */
  @Property({ length: 255, nullable: true })
  source?: string;

  @ManyToOne({ cascade: [], entity: () => Tenant, fieldName: 'tenant_key' })
  tenantKey!: Rel<Tenant>;

  @PrimaryKey()
  transactionAuditLogKey!: number;

  @ManyToOne({ cascade: [], entity: () => Transaction, fieldName: 'transaction_key' })
  transactionKey!: Rel<Transaction>;
}
