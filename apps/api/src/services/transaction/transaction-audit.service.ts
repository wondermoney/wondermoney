import type { EntityManager, FilterQuery } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { getRef } from '@utils/em-helpers';
import logger from '@utils/logger';

export interface TransactionAuditLogInput {
  accountKey?: null | number;
  /** The appuser that made the change (USER events). Omit/null for system/sync/AI. */
  actorAppuserKey?: null | number;
  actorType: TransactionAuditActorType;
  /** The owning appuser of the transaction (for scoping history queries). */
  appuserKey: number;
  changes?: Record<string, { from: unknown; to: unknown }>;
  eventType: TransactionAuditEventType;
  source?: string;
  tenantKey: number;
  transactionKey: number;
}

/**
 * Filters for the ops/monitoring audit-log reads (RAD-394). `limit`/`offset` are always present
 * (the validator defaults them); every other field narrows the result set when supplied.
 */
export interface TransactionAuditQueryInput {
  accountKey?: number;
  appuserKey?: number;
  limit: number;
  offset: number;
  since?: Date;
  /** Free-text origin, e.g. a remediation run/plan id — used to scope SYSTEM_REMEDIATION reads. */
  source?: string;
  tenantKey?: number;
}

interface LogOptions {
  /**
   * When false, the row is persisted onto the caller's unit of work but not flushed — use this
   * inside an `em.transactional(...)` block so the audit row commits atomically with the change
   * it describes. Defaults to true (standalone best-effort write).
   */
  flush?: boolean;
}

/**
 * Append-only audit trail writer for transaction changes (RAD-346, Phase 0).
 *
 * Modeled on `AssistantAuditService`: writes are best-effort and never throw — a failed audit
 * write must not break the user-facing mutation. Pass `{ flush: false }` when calling inside an
 * existing `em.transactional` so the row commits with the surrounding unit of work.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class TransactionAuditService {
  static async log(em: EntityManager, input: TransactionAuditLogInput, options?: LogOptions): Promise<null | TransactionAuditLog> {
    const shouldFlush = options?.flush !== false;
    try {
      const auditLog = new TransactionAuditLog();
      auditLog.transactionKey = getRef(em, Transaction, input.transactionKey);
      auditLog.appuserKey = getRef(em, Appuser, input.appuserKey);
      auditLog.tenantKey = getRef(em, Tenant, input.tenantKey);
      auditLog.accountKey = input.accountKey ? getRef(em, Account, input.accountKey) : undefined;
      auditLog.actorAppuserKey = input.actorAppuserKey ? getRef(em, Appuser, input.actorAppuserKey) : undefined;
      auditLog.actorType = input.actorType;
      auditLog.eventType = input.eventType;
      auditLog.source = input.source;
      auditLog.changes = sanitizeChanges(input.changes);

      if (shouldFlush) {
        await em.persist(auditLog).flush();
      } else {
        em.persist(auditLog);
      }
      return auditLog;
    } catch (error) {
      logger.warn(
        {
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          eventType: input.eventType,
          transactionKey: input.transactionKey,
        },
        'Transaction audit log write failed',
      );
      return null;
    }
  }

  /**
   * Ops/monitoring read: recent DEDUP_SKIPPED rows, newest first. RAD-394 — surfaces how often
   * sync silently skipped an incoming row. Each row's `changes.matchedOn` tells you which identity
   * branch matched; the `internalTransactionId` branch on a row with a different bank id is the
   * false-positive-skip case RAD-393 tracks. Group client-side (or use the documented SQL) for the
   * matched-on breakdown.
   */
  static async listDedupSkipped(em: EntityManager, query: TransactionAuditQueryInput): Promise<TransactionAuditLog[]> {
    return em.find(TransactionAuditLog, buildAuditWhere(TransactionAuditEventType.DEDUP_SKIPPED, query), {
      limit: query.limit,
      offset: query.offset,
      orderBy: { createdAt: 'DESC', transactionAuditLogKey: 'DESC' },
    });
  }

  /**
   * Ops/monitoring read: recent SYSTEM_REMEDIATION rows, newest first. RAD-394 — the audit trail for
   * operator-driven soft-deletes (e.g. the RAD-346 Phase 3 dedup backfill). Pass `source` to scope
   * to a single remediation run/plan.
   */
  static async listRemediations(em: EntityManager, query: TransactionAuditQueryInput): Promise<TransactionAuditLog[]> {
    return em.find(TransactionAuditLog, buildAuditWhere(TransactionAuditEventType.SYSTEM_REMEDIATION, query), {
      limit: query.limit,
      offset: query.offset,
      orderBy: { createdAt: 'DESC', transactionAuditLogKey: 'DESC' },
    });
  }
}

/**
 * Builds the `em.find` filter for an audit-log read: always pins the `eventType`, then narrows by
 * any supplied since/scope/source. `since` is inclusive (`>=`). Scope keys match against the FK
 * columns directly (no relation load).
 */
function buildAuditWhere(eventType: TransactionAuditEventType, query: TransactionAuditQueryInput): FilterQuery<TransactionAuditLog> {
  const where: Record<string, unknown> = { eventType };
  if (query.since) where['createdAt'] = { $gte: query.since };
  if (query.accountKey !== undefined) where['accountKey'] = query.accountKey;
  if (query.appuserKey !== undefined) where['appuserKey'] = query.appuserKey;
  if (query.tenantKey !== undefined) where['tenantKey'] = query.tenantKey;
  if (query.source !== undefined) where['source'] = query.source;
  return where as FilterQuery<TransactionAuditLog>;
}

/**
 * Only money/meaning fields are auditable — never store raw provider PII (IBANs, remittance text).
 * Mirrors the allowlist approach in `AssistantAuditService.sanitizeAuditMetadata`.
 */
const ALLOWED_CHANGE_FIELDS = new Set([
  'appuserCurrencyBalance',
  'balance',
  'categoryKey',
  'description',
  'editedSettlementAmount',
  'flaggedAgainstTransactionKey',
  'incomingExternalTransactionId',
  'incomingInternalTransactionId',
  'incomingNordigenInternalTransactionId',
  'matchedOn',
  'notes',
  'plan',
  'reason',
  'reviewed',
  'settlementAmount',
  'transactionDate',
  'transactionMerchantKey',
  'transactionStatusKey',
]);

function sanitizeChanges(changes: TransactionAuditLogInput['changes']): TransactionAuditLogInput['changes'] {
  if (!changes) return undefined;
  const entries = Object.entries(changes).filter(([key]) => ALLOWED_CHANGE_FIELDS.has(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export { TransactionAuditActorType, TransactionAuditEventType };
