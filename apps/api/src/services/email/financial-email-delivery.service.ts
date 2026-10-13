import type { EntityManager } from '@mikro-orm/postgresql';

import type { RenderedEmailOutcome } from '@service/email/email';

export interface CrossingReservation {
  budgetKey: number;
  budgetTemplateCategoryKey: number;
  month: number;
  tenantKey: number;
  threshold: 80 | 100;
  year: number;
}

export type FinancialDeliveryResult =
  | { deliveryKey: string; newlyAcquiredCrossingKeys: string[]; result: 'reserved'; snapshot: Record<string, unknown> }
  | { reason: 'already_claimed' | 'no_new_claims'; result: 'suppressed' }
  | { result: 'accepted' }
  | { result: 'permanent_failed' }
  | { result: 'retryable_failed' }
  | { result: 'unknown' };

class ReservationConflict extends Error {}

export class FinancialEmailReservationService {
  constructor(private readonly em: EntityManager) {}

  async failBeforeProvider(appuserKey: number, deliveryKey: string, reason: string) {
    await this.em.getConnection().execute(
      `update "sent_email" set "status" = 'failed', "retryable" = true, "terminal_reason" = ?, "updated_at" = now()
       where "appuser_appuser_key" = ? and ("email_type" = ? or "metadata"->>'ownerDeliveryKey' = ?)
         and "status" = 'sending' and "provider_request_started_at" is null`,
      [reason, appuserKey, deliveryKey, deliveryKey],
    );
  }

  async inspectBudgetClaims(appuserKey: number, crossings: CrossingReservation[]) {
    const keys = [...new Set(crossings.map(budgetCrossingKey))];
    if (!keys.length) return { newCrossingKeys: [], reason: 'no_new_claims' as const };
    const rows = await this.em.getConnection().execute<{ attemptCount: number; emailType: string; providerRequestStartedAt: Date | null; retryable: boolean | null; status: string; updatedAt: Date }[]>(
      'select "email_type" as "emailType", "status", "retryable", "attempt_count" as "attemptCount", "provider_request_started_at" as "providerRequestStartedAt", "updated_at" as "updatedAt" from "sent_email" where "appuser_appuser_key" = ? and "email_type" = any(?::text[])',
      [appuserKey, keys],
    );
    const byKey = new Map(rows.map((row) => [row.emailType, row]));
    const newCrossingKeys: string[] = [];
    for (const key of keys) {
      const row = byKey.get(key);
      if (!row) { newCrossingKeys.push(key); continue; }
      if (row.status === 'sent') continue;
      const stale = row.status === 'sending' && row.providerRequestStartedAt == null && Date.now() - new Date(row.updatedAt).getTime() >= 30 * 60 * 1000;
      const retryable = row.status === 'failed' && row.retryable === true && row.attemptCount < 3;
      if (stale || retryable) newCrossingKeys.push(key);
      else return { newCrossingKeys: [], reason: 'already_claimed' as const };
    }
    return { newCrossingKeys, reason: newCrossingKeys.length ? 'new_claims' as const : 'no_new_claims' as const };
  }

  async inspectMonthlyEnvelope(appuserKey: number, year: number, month: number) {
    const key = monthlyEnvelopeKey(year, month);
    const result = await this.em.getConnection().execute<{ attemptCount: number; providerRequestStartedAt: Date | null; retryable: boolean | null; status: string; updatedAt: Date }>(
      'select "status", "retryable", "attempt_count" as "attemptCount", "provider_request_started_at" as "providerRequestStartedAt", "updated_at" as "updatedAt" from "sent_email" where "appuser_appuser_key" = ? and "email_type" = ?',
      [appuserKey, key],
      'get',
    );
    const row = result as undefined | { attemptCount: number; providerRequestStartedAt: Date | null; retryable: boolean | null; status: string; updatedAt: Date };
    if (!row) return { reason: 'new_envelope' as const };
    const stale = row.status === 'sending' && row.providerRequestStartedAt == null && Date.now() - new Date(row.updatedAt).getTime() >= 30 * 60 * 1000;
    const retryable = row.status === 'failed' && row.retryable === true && row.attemptCount < 3;
    return { reason: stale || retryable ? 'retryable' as const : 'already_claimed' as const };
  }

  async inspectWeeklyEnvelope(appuserKey: number, isoWeekYear: number, isoWeek: number) {
    const key = weeklyEnvelopeKey(isoWeekYear, isoWeek);
    const result = await this.em.getConnection().execute<{ attemptCount: number; providerRequestStartedAt: Date | null; retryable: boolean | null; status: string; updatedAt: Date }>(
      'select "status", "retryable", "attempt_count" as "attemptCount", "provider_request_started_at" as "providerRequestStartedAt", "updated_at" as "updatedAt" from "sent_email" where "appuser_appuser_key" = ? and "email_type" = ?',
      [appuserKey, key],
      'get',
    );
    const row = result as undefined | { attemptCount: number; providerRequestStartedAt: Date | null; retryable: boolean | null; status: string; updatedAt: Date };
    if (!row) return { reason: 'new_envelope' as const };
    const stale = row.status === 'sending' && row.providerRequestStartedAt == null && Date.now() - new Date(row.updatedAt).getTime() >= 30 * 60 * 1000;
    const retryable = row.status === 'failed' && row.retryable === true && row.attemptCount < 3;
    return { reason: stale || retryable ? 'retryable' as const : 'already_claimed' as const };
  }

  async loadRetrySnapshot(appuserKey: number, deliveryKey: string): Promise<null | Record<string, unknown>> {
    const result = await this.em.getConnection().execute<{ metadata: null | Record<string, unknown> }>(
      `select "metadata" from "sent_email" where "appuser_appuser_key" = ? and "email_type" = ?
         and "status" = 'failed' and "retryable" = true and "attempt_count" < 3`,
      [appuserKey, deliveryKey],
      'get',
    );
    return (result as undefined | { metadata: null | Record<string, unknown> })?.metadata ?? null;
  }

  async persistRenderedSnapshot(appuserKey: number, deliveryKey: string, snapshot: Record<string, unknown>) {
    const result = await this.em.getConnection().execute<{ affectedRows?: number; rowCount?: number }>(
      `update "sent_email" set "metadata" = ?, "updated_at" = now()
       where "appuser_appuser_key" = ? and "email_type" = ? and "status" = 'sending' and "provider_request_started_at" is null`,
      [JSON.stringify(snapshot), appuserKey, deliveryKey],
      'run',
    );
    return (result.affectedRows ?? result.rowCount ?? 0) === 1;
  }

  async recordProviderStart(appuserKey: number, deliveryKey: string, startedAt = new Date()) {
    return this.em.transactional(async (tx) => {
      const envelopeResult = await tx.getConnection().execute<{ status: string }>(
        `select "status" from "sent_email" where "appuser_appuser_key" = ? and "email_type" = ?
         and "status" = 'sending' and "provider_request_started_at" is null for update`,
        [appuserKey, deliveryKey],
        'get',
      );
      if (!(envelopeResult as undefined | { status: string })) return false;
      const claims = await tx.getConnection().execute<{ providerRequestStartedAt: Date | null; status: string }[]>(
        `select "status", "provider_request_started_at" as "providerRequestStartedAt"
         from "sent_email" where "appuser_appuser_key" = ? and "metadata"->>'ownerDeliveryKey' = ? for update`,
        [appuserKey, deliveryKey],
      );
      if (claims.some((claim) => claim.status !== 'sending' || claim.providerRequestStartedAt != null)) return false;
      await tx.getConnection().execute(
        `update "sent_email" set "provider_request_started_at" = ?, "updated_at" = ?
         where "appuser_appuser_key" = ? and ("email_type" = ? or "metadata"->>'ownerDeliveryKey' = ?)
           and "status" = 'sending'`,
        [startedAt, startedAt, appuserKey, deliveryKey, deliveryKey],
      );
      return true;
    });
  }

  async reserveBudget(input: { appuserKey: number; crossings: CrossingReservation[]; localDate: string; snapshot: Record<string, unknown> }): Promise<FinancialDeliveryResult> {
    const deliveryKey = budgetEnvelopeKey(input.localDate);
    const crossingKeys = [...new Set(input.crossings.map(budgetCrossingKey))];
    if (crossingKeys.length === 0) return { reason: 'no_new_claims', result: 'suppressed' };
    try {
      return await this.em.transactional(async (tx) => {
        const aggregate = await acquireSentEmail(tx, input.appuserKey, deliveryKey, input.snapshot);
        if (!aggregate.acquired) return { reason: 'already_claimed', result: 'suppressed' } as const;
        const newlyAcquiredCrossingKeys: string[] = [];
        for (const crossingKey of crossingKeys) {
          const claim = await acquireSentEmail(tx, input.appuserKey, crossingKey, { ownerDeliveryKey: deliveryKey }, deliveryKey);
          if (!claim.acquired && !claim.satisfied) throw new ReservationConflict();
          if (claim.acquired) newlyAcquiredCrossingKeys.push(crossingKey);
        }
        if (newlyAcquiredCrossingKeys.length === 0) {
          await tx.getConnection().execute(
            'delete from "sent_email" where "appuser_appuser_key" = ? and "email_type" = ? and "status" = ? and "provider_request_started_at" is null',
            [input.appuserKey, deliveryKey, 'sending'],
          );
          return { reason: 'no_new_claims', result: 'suppressed' } as const;
        }
        return { deliveryKey, newlyAcquiredCrossingKeys, result: 'reserved', snapshot: aggregate.snapshot ?? input.snapshot } as const;
      });
    } catch (error) {
      if (error instanceof ReservationConflict) return { reason: 'already_claimed', result: 'suppressed' };
      throw error;
    }
  }

  async reserveMonthly(input: { appuserKey: number; month: number; snapshot: Record<string, unknown>; year: number }): Promise<FinancialDeliveryResult> {
    const deliveryKey = monthlyEnvelopeKey(input.year, input.month);
    const reserved = await this.em.transactional((tx) => acquireSentEmail(tx, input.appuserKey, deliveryKey, input.snapshot));
    return reserved.acquired ? { deliveryKey, newlyAcquiredCrossingKeys: [], result: 'reserved', snapshot: reserved.snapshot ?? input.snapshot } : { reason: 'already_claimed', result: 'suppressed' };
  }

  async reserveWeekly(input: { appuserKey: number; isoWeek: number; isoWeekYear: number; snapshot: Record<string, unknown> }): Promise<FinancialDeliveryResult> {
    const deliveryKey = weeklyEnvelopeKey(input.isoWeekYear, input.isoWeek);
    const reserved = await this.em.transactional((tx) => acquireSentEmail(tx, input.appuserKey, deliveryKey, input.snapshot));
    return reserved.acquired ? { deliveryKey, newlyAcquiredCrossingKeys: [], result: 'reserved', snapshot: reserved.snapshot ?? input.snapshot } : { reason: 'already_claimed', result: 'suppressed' };
  }

  async transitionOutcome(appuserKey: number, deliveryKey: string, outcome: RenderedEmailOutcome): Promise<FinancialDeliveryResult> {
    if (outcome.type === 'intercepted') outcome = { type: 'unknown' };
    return this.em.transactional(async (tx) => {
      let retryLimitExhausted = false;
      if (outcome.type === 'rejected' && outcome.retryable) {
        const attemptResult = await tx.getConnection().execute<{ attemptCount: number }>(
          'select "attempt_count" as "attemptCount" from "sent_email" where "appuser_appuser_key" = ? and "email_type" = ? for update',
          [appuserKey, deliveryKey],
          'get',
        );
        retryLimitExhausted = ((attemptResult as undefined | { attemptCount: number })?.attemptCount ?? 3) >= 3;
      }
      const transition = outcome.type === 'accepted'
        ? { providerOutcome: 'accepted', result: 'accepted' as const, retryable: false, status: 'sent', terminalReason: null }
        : outcome.type === 'unknown'
          ? { providerOutcome: 'unknown', result: 'unknown' as const, retryable: false, status: 'unknown', terminalReason: 'provider_outcome_unknown' }
          : outcome.retryable && !retryLimitExhausted
            ? { providerOutcome: 'rejected', result: 'retryable_failed' as const, retryable: true, status: 'failed', terminalReason: null }
            : { providerOutcome: 'rejected', result: 'permanent_failed' as const, retryable: false, status: 'failed', terminalReason: retryLimitExhausted ? 'retry_limit_exhausted' : 'provider_rejected_permanent' };
      await tx.getConnection().execute(
        `update "sent_email" set "status" = ?, "provider_outcome" = ?, "provider_message_ids" = ?, "retryable" = ?, "terminal_reason" = ?,
                "metadata" = case when ?::text = 'sent' then jsonb_build_object('deliveryKey', "email_type") else "metadata" end, "updated_at" = now()
         where "appuser_appuser_key" = ? and "email_type" = ?`,
        [transition.status, transition.providerOutcome, outcome.type === 'accepted' ? JSON.stringify(outcome.providerMessageIds) : null, transition.retryable, transition.terminalReason, transition.status, appuserKey, deliveryKey],
      );
      await tx.getConnection().execute(
        `update "sent_email" set "status" = ?, "provider_outcome" = ?, "provider_message_ids" = null, "retryable" = ?, "terminal_reason" = ?,
                "metadata" = case when ?::text = 'sent' then jsonb_build_object('ownerDeliveryKey', ?::text) else "metadata" end, "updated_at" = now()
         where "appuser_appuser_key" = ? and "metadata"->>'ownerDeliveryKey' = ?`,
        [transition.status, transition.providerOutcome, transition.retryable, transition.terminalReason, transition.status, deliveryKey, appuserKey, deliveryKey],
      );
      return { result: transition.result };
    });
  }
}

export function budgetCrossingKey(crossing: CrossingReservation) {
  return `ba:c:${crossing.tenantKey}:${crossing.budgetKey}:${crossing.budgetTemplateCategoryKey}:${crossing.year}${String(crossing.month).padStart(2, '0')}:${crossing.threshold}`;
}

export function budgetEnvelopeKey(localDate: string) {
  return `ba:d:${localDate.replaceAll('-', '')}`;
}

export function monthlyEnvelopeKey(year: number, month: number) {
  return `ms:m:${year}${String(month).padStart(2, '0')}`;
}

export function weeklyEnvelopeKey(isoWeekYear: number, isoWeek: number) {
  return `wi:w:${isoWeekYear}-W${String(isoWeek).padStart(2, '0')}`;
}

async function acquireSentEmail(
  em: EntityManager,
  appuserKey: number,
  emailType: string,
  metadata: Record<string, unknown>,
  newOwnerDeliveryKey?: string,
): Promise<{ acquired: boolean; satisfied?: boolean; snapshot?: Record<string, unknown> }> {
  const inserted = await insertSentEmail(em, appuserKey, emailType, metadata);
  if (inserted) return { acquired: true, snapshot: metadata };
  const existingResult = await em.getConnection().execute<{ attemptCount: number; metadata: null | Record<string, unknown>; providerRequestStartedAt: Date | null; retryable: boolean | null; status: string; updatedAt: Date }>(
    'select "status", "retryable", "metadata", "attempt_count" as "attemptCount", "provider_request_started_at" as "providerRequestStartedAt", "updated_at" as "updatedAt" from "sent_email" where "appuser_appuser_key" = ? and "email_type" = ? for update',
    [appuserKey, emailType],
    'get',
  );
  const existing = existingResult as undefined | { attemptCount: number; metadata: null | Record<string, unknown>; providerRequestStartedAt: Date | null; retryable: boolean | null; status: string; updatedAt: Date };
  if (!existing) return { acquired: false };
  if (existing.status === 'sent' && newOwnerDeliveryKey) return { acquired: false, satisfied: true };
  const stalePreProvider = existing.status === 'sending' && existing.providerRequestStartedAt == null && Date.now() - new Date(existing.updatedAt).getTime() >= 30 * 60 * 1000;
  const retryableFailure = existing.status === 'failed' && existing.retryable === true && existing.attemptCount < 3;
  if (!stalePreProvider && !retryableFailure) return { acquired: false };
  const formerOwner = typeof existing.metadata?.['ownerDeliveryKey'] === 'string' ? existing.metadata['ownerDeliveryKey'] : undefined;
  if (newOwnerDeliveryKey && formerOwner && formerOwner !== newOwnerDeliveryKey) {
    await em.getConnection().execute(
      'update "sent_email" set "retryable" = false, "terminal_reason" = ?, "updated_at" = now() where "appuser_appuser_key" = ? and "email_type" = ?',
      ['crossing_claim_taken_over', appuserKey, formerOwner],
    );
  }
  const nextMetadata = newOwnerDeliveryKey ? metadata : (existing.metadata ?? metadata);
  await em.getConnection().execute(
    'update "sent_email" set "status" = ?, "retryable" = null, "terminal_reason" = null, "attempt_count" = "attempt_count" + 1, "metadata" = ?::jsonb, "provider_request_started_at" = null, "provider_outcome" = null, "updated_at" = now() where "appuser_appuser_key" = ? and "email_type" = ?',
    ['sending', JSON.stringify(nextMetadata), appuserKey, emailType],
  );
  return { acquired: true, snapshot: nextMetadata };
}

async function insertSentEmail(em: EntityManager, appuserKey: number, emailType: string, metadata: Record<string, unknown>) {
  const result = await em.getConnection().execute<{ sentEmailKey: number }>(
    `insert into "sent_email" ("appuser_appuser_key", "email_type", "sent_at", "status", "attempt_count", "metadata", "created_at", "updated_at")
     values (?, ?, now(), 'sending', 1, ?::jsonb, now(), now())
     on conflict ("appuser_appuser_key", "email_type") do nothing returning "sent_email_key" as "sentEmailKey"`,
    [appuserKey, emailType, JSON.stringify(metadata)],
    'get',
  );
  return result as undefined | { sentEmailKey: number };
}
