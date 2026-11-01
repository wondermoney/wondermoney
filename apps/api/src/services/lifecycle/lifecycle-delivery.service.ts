import { randomUUID } from 'node:crypto';

import type { EntityManager, FilterQuery, RequiredEntityData } from '@mikro-orm/core';
import { LockMode } from '@mikro-orm/core';

import type { SupportedLanguages } from '@entity/Appuser';
import { LifecycleDelivery } from '@entity/LifecycleDelivery';
import { LifecycleCampaign, LifecycleDeliveryStatus } from '@service/lifecycle/lifecycle-types';

export interface UpsertDeliveryArgs {
  appuserKey: number;
  campaign: LifecycleCampaign;
  scheduledFor: Date;
  step: string;
  templateVersion: string;
}

/**
 * Idempotent on (appuserKey, campaign, step): returns the existing row if one is
 * already recorded (any status), otherwise creates a PENDING delivery. The unique
 * constraint is the ultimate guard; this avoids racing to violate it.
 */
export async function upsertPendingDelivery(em: EntityManager, args: UpsertDeliveryArgs): Promise<LifecycleDelivery> {
  const existing = await em.findOne(LifecycleDelivery, { appuserKey: args.appuserKey, campaign: args.campaign, step: args.step } as FilterQuery<LifecycleDelivery>);
  if (existing) return existing;
  const row = em.create(LifecycleDelivery, {
    appuserKey: args.appuserKey,
    campaign: args.campaign,
    providerAttemptCount: 0,
    scheduledFor: args.scheduledFor,
    status: LifecycleDeliveryStatus.PENDING,
    step: args.step,
    templateVersion: args.templateVersion,
  } as unknown as RequiredEntityData<LifecycleDelivery>);
  await em.persist(row).flush();
  return row;
}

/**
 * Matches the CHECK constraint on `lifecycle_delivery.provider_attempt_count`
 * (`between 0 and 2`). The column has been declared since the table was created and
 * was never written by any code path — the whole claim state machine was copied from
 * `trial_lifecycle_delivery` and left inert, which is what made a double-send possible.
 */
export const LIFECYCLE_MAX_PROVIDER_ATTEMPTS = 2;

/** How long a claim is considered live before the stale sweep may take it over. */
const LIFECYCLE_CLAIM_LEASE_MS = 5 * 60_000;

export interface LifecycleClaim {
  claimToken: string;
  delivery: LifecycleDelivery;
}

/**
 * Takes an exclusive, attempt-consuming claim on a PENDING delivery before the provider
 * is called.
 *
 * === Why claim first ===
 *
 * A send path of read status → call Resend → write status, with no lock, no
 * transaction and no conditional update, double-sends. `policy: 'exclusive'` + a `singletonKey` stop
 * two jobs running *concurrently*, but the window that matters is sequential: the job
 * crashes, times out, or throws on an ambiguous provider outcome **after** Resend
 * accepted the mail and **before** the status write commits. pg-boss then retries, the
 * row still reads PENDING, and the same person gets the same email again.
 *
 * Claiming first inverts that. The attempt is consumed and the status moved off PENDING
 * *before* anything leaves the process, so a retry after a successful send finds a
 * non-PENDING row and returns without sending. This is the same shape as
 * `services/bank-recovery.service.ts`.
 *
 * Returns `null` when the row is not claimable (already claimed, already resolved, or
 * out of attempts) — the caller must treat that as "do not send".
 */
export async function claimPendingDelivery(
  em: EntityManager,
  deliveryKey: number,
  jobId: string,
  leaseMs: number = LIFECYCLE_CLAIM_LEASE_MS,
): Promise<LifecycleClaim | null> {
  if (!jobId || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('Invalid lifecycle delivery claim');
  return em.transactional(async (transactional) => {
    const delivery = await transactional.findOne(
      LifecycleDelivery,
      { lifecycleDeliveryKey: deliveryKey },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!delivery) return null;
    if (delivery.status !== LifecycleDeliveryStatus.PENDING) return null;
    if (delivery.providerAttemptCount >= LIFECYCLE_MAX_PROVIDER_ATTEMPTS) return null;

    const now = new Date();
    const claimToken = randomUUID();
    delivery.providerAttemptCount += 1;
    delivery.claimToken = claimToken;
    delivery.claimJobId = jobId;
    delivery.claimedAt = now;
    delivery.claimExpiresAt = new Date(now.getTime() + leaseMs);
    delivery.status = LifecycleDeliveryStatus.CLAIMED;
    await transactional.flush();
    return { claimToken, delivery };
  });
}

/**
 * Returns a claimed delivery to PENDING so a later attempt can retry it. Only valid for
 * failures that happened **before** the provider accepted anything — an ambiguous
 * outcome must never come back here, because "maybe delivered" plus "retry" is the
 * double-send this whole mechanism exists to prevent.
 *
 * Every claim field is cleared because the table's status CHECK constraint requires a
 * PENDING row to have all of them null.
 */
export function releaseClaim(d: LifecycleDelivery, outcomeCode: string): void {
  d.status = LifecycleDeliveryStatus.PENDING;
  d.outcomeCode = outcomeCode;
  d.claimToken = undefined;
  d.claimJobId = undefined;
  d.claimedAt = undefined;
  d.claimExpiresAt = undefined;
  d.completedAt = undefined;
  d.sentAt = undefined;
}

/** Terminal failure: the provider rejected the send and retrying it cannot help. Caller flushes. */
function markFailed(d: LifecycleDelivery, outcomeCode: string): void {
  d.status = LifecycleDeliveryStatus.FAILED;
  d.outcomeCode = outcomeCode;
  d.sentAt = undefined;
  d.completedAt = new Date();
}

/**
 * Terminal-but-unknown: the provider call did not report success *or* a pre-acceptance
 * failure, so the mail may or may not have gone out. Deliberately terminal — a human
 * resolves it from `provider_message_id`/Resend rather than the system guessing and
 * risking a second copy. Caller flushes.
 */
function markNeedsReconciliation(d: LifecycleDelivery, outcomeCode: string): void {
  d.status = LifecycleDeliveryStatus.NEEDS_RECONCILIATION;
  d.outcomeCode = outcomeCode;
  d.completedAt = new Date();
}

/**
 * Sweeps claims whose lease expired without the sender resolving them — the signature of
 * a worker that died mid-send. They go to NEEDS_RECONCILIATION rather than back to
 * PENDING for the same reason as `markNeedsReconciliation`: nobody knows whether Resend
 * accepted the message, and guessing "no" sends it twice.
 */
export async function reconcileStaleClaims(em: EntityManager, now: Date = new Date(), limit = 200): Promise<number> {
  const stale = await em.find(
    LifecycleDelivery,
    { claimExpiresAt: { $lte: now }, status: LifecycleDeliveryStatus.CLAIMED },
    { limit, orderBy: { lifecycleDeliveryKey: 'asc' } },
  );
  for (const delivery of stale) markNeedsReconciliation(delivery, 'stale_claim');
  if (stale.length > 0) await em.flush();
  return stale.length;
}

/**
 * How a failed provider attempt must be resolved. The distinction is the whole point:
 *
 * - `local` — the failure happened **before** anything reached the provider (render
 *   threw, the client could not be constructed). Nothing was delivered, so the claim is
 *   released and the job may retry.
 * - `rejected` — the provider explicitly refused the message. Terminal; retrying a
 *   permanent rejection only burns attempts.
 * - `unknown` — the provider may or may not have accepted it (network cut, timeout,
 *   null status code). Terminal by design: this is exactly the state where a retry
 *   sends a second copy.
 */
export type LifecycleProviderFailure = 'local' | 'rejected' | 'unknown';

/** Provider failure carrying its classification, so the claim can be resolved correctly. */
export class LifecycleProviderError extends Error {
  constructor(public readonly failure: LifecycleProviderFailure, public readonly code: string) {
    super(`Lifecycle email not accepted (${failure}:${code})`);
    this.name = 'LifecycleProviderError';
  }
}

/**
 * Applies the correct terminal/release transition for a failed attempt and reports
 * whether the caller should rethrow (i.e. let pg-boss retry). Caller flushes.
 */
export function resolveProviderFailure(d: LifecycleDelivery, error: unknown): { shouldRetry: boolean } {
  const failure: LifecycleProviderFailure = error instanceof LifecycleProviderError ? error.failure : 'unknown';
  const code = error instanceof LifecycleProviderError ? error.code : 'provider_error';
  if (failure === 'local') {
    // Releasing a row whose attempt budget is already spent would park it PENDING
    // forever — claimable by nothing, resolved by nobody.
    if (d.providerAttemptCount >= LIFECYCLE_MAX_PROVIDER_ATTEMPTS) {
      markFailed(d, code);
      return { shouldRetry: false };
    }
    releaseClaim(d, code);
    return { shouldRetry: true };
  }
  if (failure === 'rejected') {
    markFailed(d, code);
    return { shouldRetry: false };
  }
  markNeedsReconciliation(d, code);
  return { shouldRetry: false };
}

/** Transitions a delivery to SENT. Caller flushes. */
export function markSent(d: LifecycleDelivery, providerMessageId: string, language: SupportedLanguages): void {
  const now = new Date();
  d.status = LifecycleDeliveryStatus.SENT;
  d.providerMessageId = providerMessageId;
  d.languageAtSend = language;
  d.sentAt = now;
  d.completedAt = now;
}

/** Transitions a delivery to SUPPRESSED with a machine-readable reason. Caller flushes. */
export function markSuppressed(d: LifecycleDelivery, outcomeCode: string): void {
  d.status = LifecycleDeliveryStatus.SUPPRESSED;
  d.outcomeCode = outcomeCode;
  d.completedAt = new Date();
}

/**
 * Removes not-yet-sent (PENDING) deliveries for the given steps — used to cancel
 * a scheduled rescue the moment the user does the thing the rescue was chasing
 * (e.g. connects an account). Already-sent/suppressed rows are left untouched.
 * Returns the number of rows cancelled.
 */
export async function cancelPending(em: EntityManager, appuserKey: number, campaign: LifecycleCampaign, steps: string[]): Promise<number> {
  const rows = await em.find(LifecycleDelivery, { appuserKey, campaign, status: LifecycleDeliveryStatus.PENDING, step: { $in: steps } } as FilterQuery<LifecycleDelivery>);
  for (const row of rows) em.remove(row);
  await em.flush();
  return rows.length;
}
