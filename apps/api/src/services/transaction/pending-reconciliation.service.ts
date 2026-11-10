/**
 * Account-level pending→posted reconciliation planner.
 *
 * Given the booked rows arriving in a sync and the account's currently-stored PENDING rows, decide
 * which pending each booked row would promote. Each pending can be claimed at most once, so two
 * identical booked rows never both promote the same pending. Ambiguous booked rows (more than one
 * candidate pending) are left alone — we never guess with money.
 *
 * The planner runs the exact pass over every booked row before the loose pass, so a loose match can
 * never take a pending a later booked row would have matched exactly. Each planned promotion carries
 * the pass that found it and the amount difference, for the audit trail.
 *
 * This is planning only — it returns intended promotions. Applying them (mutating the pending row
 * in place → BOOKED) is a separate, flag-gated step; the first rollout logs these intents to the
 * audit table in dry-run mode so we can measure match quality before mutating anything.
 */
import type { EntityManager } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import type { Account } from '@entity/Account';
import type { AppuserTenant } from '@entity/AppuserTenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import type { TransactionStatus } from '@entity/TransactionStatus';
import logger from '@utils/logger';

import { findPendingMatchInPass, type MatchableTransaction, type MatchOptions, type PendingMatchPass } from './pending-posted-match.service';
import { TransactionAuditService } from './transaction-audit.service';

/** Feature flag for pending→posted reconciliation. `apply` (default/live) · `dry_run` · `off` (kill switch). */
const PENDING_RECONCILIATION_FLAG = 'TRANSACTION_PENDING_RECONCILIATION';

export interface PlannedPromotion {
  /** Absolute amount difference between the booked and pending rows, in major units. */
  amountDifference: number;
  /** Index into the booked-rows array that would be promoted. */
  bookedIndex: number;
  /** Which matching pass found the candidate. */
  matchPass: PendingMatchPass;
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
  const looseCandidates: number[] = [];

  // Pass 1: every exact match claims its pending first, so a loose match can never take a pending
  // that a later booked row would have matched exactly.
  bookedRows.forEach((booked, bookedIndex) => {
    const result = findPendingMatchInPass(booked, available, 'exact', options);
    if (result.status === 'promote') {
      plan.push({ amountDifference: result.amountDifference, bookedIndex, matchPass: 'exact', pendingKey: result.pending.transactionKey });
      consume(available, result.pending);
      return;
    }
    // An ambiguous exact match is left alone: falling through to the looser pass would guess.
    if (result.status === 'no_match') looseCandidates.push(bookedIndex);
  });

  // Pass 2: the loose pass only sees booked rows with no exact candidate and pendings no exact
  // match claimed.
  for (const bookedIndex of looseCandidates) {
    const booked = bookedRows[bookedIndex];
    if (!booked) continue;
    const result = findPendingMatchInPass(booked, available, 'loose', options);
    if (result.status !== 'promote') continue;
    plan.push({ amountDifference: result.amountDifference, bookedIndex, matchPass: 'loose', pendingKey: result.pending.transactionKey });
    consume(available, result.pending);
  }

  return plan.sort((a, b) => a.bookedIndex - b.bookedIndex);
}

function consume<T>(available: T[], claimed: T): void {
  const index = available.indexOf(claimed);
  if (index !== -1) available.splice(index, 1);
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
      // Hidden pendings too, as the live path (`applyPromotions`) reads them.
      { filters: { [HIDDEN_FILTER]: false }, populate: ['settlementCurrencyKey', 'transactionMerchantKey'] },
    );
    if (pendings.length === 0) return [];

    const matchablePendings = pendings.map((pending) => ({
      counterparty: pending.transactionMerchantKey?.name,
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
      const booked = params.bookedRows[promotion.bookedIndex];
      const changes: Record<string, { from: unknown; to: unknown }> = {
        amountDifference: { from: null, to: promotion.amountDifference },
        matchPass: { from: null, to: promotion.matchPass },
        transactionStatusKey: { from: 'PENDING', to: 'BOOKED' },
      };
      if (promotion.matchPass === 'loose' && booked) {
        changes['settlementAmount'] = { from: pending.settlementAmount ?? 0, to: booked.settlementAmount };
      }
      await TransactionAuditService.log(em, {
        accountKey: params.account.accountKey,
        actorType: TransactionAuditActorType.SYNC,
        appuserKey: pending.appuserKey?.appuserKey ?? 0,
        changes,
        eventType: TransactionAuditEventType.PENDING_PROMOTED,
        source: 'pending-reconciliation:dry-run',
        tenantKey: pending.tenantKey?.tenantKey ?? 0,
        transactionKey: promotion.pendingKey,
      });
    }

    if (plan.length > 0) logger.info({ accountKey: params.account.accountKey, promotions: plan.length }, 'Pending reconciliation (dry-run): intended promotions logged');
    return plan;
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : 'unknown' }, 'Pending reconciliation dry-run failed');
    return [];
  }
}
