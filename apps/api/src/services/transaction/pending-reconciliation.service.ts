/**
 * Account-level pending→posted reconciliation planner (RAD-346, Phase 4).
 *
 * Given the booked rows arriving in a sync and the account's currently-stored PENDING rows, decide
 * which pending each booked row would promote. Each pending can be claimed at most once, so two
 * identical booked rows never both promote the same pending. Ambiguous booked rows (more than one
 * candidate pending) are left alone — we never guess with money.
 *
 * This is planning only — it returns intended promotions. Applying them (mutating the pending row
 * in place → BOOKED) is a separate, flag-gated step; the first rollout logs these intents to the
 * audit table in dry-run mode so we can measure match quality before mutating anything.
 */
import type { EntityManager } from '@mikro-orm/core';

import type { Account } from '@entity/Account';
import type { AppuserTenant } from '@entity/AppuserTenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import type { TransactionStatus } from '@entity/TransactionStatus';
import logger from '@utils/logger';

import { findPromotablePendingMatch, type MatchableTransaction, type MatchOptions } from './pending-posted-match.service';
import { TransactionAuditService } from './transaction-audit.service';

/** Feature flag for pending→posted reconciliation. `apply` (default/live) · `dry_run` · `off` (kill switch). */
export const PENDING_RECONCILIATION_FLAG = 'TRANSACTION_PENDING_RECONCILIATION';

export interface PlannedPromotion {
  /** Index into the booked-rows array that would be promoted. */
  bookedIndex: number;
  /** transactionKey of the stored pending row it would promote in place. */
  pendingKey: number;
}

export type ReconciliationMode = 'apply' | 'dry_run' | 'off';

/**
 * Resolve the rollout mode. Defaults to `apply` (live) so reconciliation runs on deploy; set the
 * env flag to `off` for an instant kill switch, or `dry_run` to observe without mutating.
 */
export function getReconciliationMode(): ReconciliationMode {
  const value = (process.env[PENDING_RECONCILIATION_FLAG] ?? 'apply').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(value)) return 'off';
  if (['dry-run', 'dry_run', 'dryrun'].includes(value)) return 'dry_run';
  return 'apply';
}

export function planPromotions(
  bookedRows: MatchableTransaction[],
  pendingRows: (MatchableTransaction & { transactionKey: number })[],
  options?: MatchOptions,
): PlannedPromotion[] {
  const available = [...pendingRows];
  const plan: PlannedPromotion[] = [];

  bookedRows.forEach((booked, bookedIndex) => {
    const result = findPromotablePendingMatch(booked, available, options);
    if (result.status !== 'promote') return;
    plan.push({ bookedIndex, pendingKey: result.pending.transactionKey });
    // Consume the claimed pending so a later booked row can't promote it again.
    const claimedIndex = available.indexOf(result.pending);
    if (claimedIndex !== -1) available.splice(claimedIndex, 1);
  });

  return plan;
}

/**
 * Dry-run reconciliation for one account during sync: load the account's stored PENDING rows, plan
 * which incoming booked rows would promote them, and record each intended promotion as a
 * `PENDING_PROMOTED` audit entry — WITHOUT mutating any transaction. This gives real match-rate
 * telemetry (and a paper trail of what a live rollout would do) before we ever rewrite money.
 * Best-effort throughout; never throws into the sync.
 */
export async function logDryRunPromotions(
  em: EntityManager,
  params: { account: Account; bookedRows: MatchableTransaction[]; options?: MatchOptions; pendingStatus: TransactionStatus; tenant: AppuserTenant },
): Promise<PlannedPromotion[]> {
  try {
    const pendings = await em.find(
      Transaction,
      { accountKey: params.account, deletedAt: undefined, transactionStatusKey: params.pendingStatus },
      { populate: ['settlementCurrencyKey'] },
    );
    if (pendings.length === 0) return [];

    const matchablePendings = pendings.map((pending) => ({
      currencyCode: pending.settlementCurrencyKey?.code ?? '',
      settlementAmount: pending.settlementAmount ?? 0,
      transactionDate: pending.transactionDate ?? new Date(0),
      transactionKey: pending.transactionKey,
    }));

    const plan = planPromotions(params.bookedRows, matchablePendings, params.options);
    const pendingByKey = new Map(pendings.map((pending) => [pending.transactionKey, pending]));

    for (const promotion of plan) {
      const pending = pendingByKey.get(promotion.pendingKey);
      if (!pending) continue;
      await TransactionAuditService.log(em, {
        accountKey: params.account.accountKey,
        actorType: TransactionAuditActorType.SYNC,
        appuserKey: pending.appuserKey?.appuserKey ?? 0,
        changes: { transactionStatusKey: { from: 'PENDING', to: 'BOOKED' } },
        eventType: TransactionAuditEventType.PENDING_PROMOTED,
        source: 'pending-reconciliation:dry-run',
        tenantKey: pending.tenantKey?.tenantKey ?? 0,
        transactionKey: promotion.pendingKey,
      });
    }

    if (plan.length > 0) logger.info({ accountKey: params.account.accountKey, promotions: plan.length }, 'RAD-346 pending reconciliation (dry-run): intended promotions logged');
    return plan;
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : 'unknown' }, 'Pending reconciliation dry-run failed');
    return [];
  }
}
