import { randomUUID } from 'node:crypto';

import { type EntityManager, LockMode, Reference } from '@mikro-orm/core';

import { Appuser, SupportedLanguages } from '@entity/Appuser';
import {
  BankRecoveryAuthorizationBasis,
  BankRecoveryDelivery,
  BankRecoveryDeliveryStatus,
  BankRecoveryTreatmentMode,
} from '@entity/BankRecoveryDelivery';
import { BankSyncFinality, BankSyncIncident } from '@entity/BankSyncIncident';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { categoryEnabled, EmailCategory } from '@service/email/email-preferences';
const LIFECYCLE_EMAIL_AUTHORIZATION_POLICY_VERSION = 'lifecycle.v1';
const MAX_PROVIDER_ATTEMPTS = 2;
const SAFE_PROVIDER_ID = /^[\w.:-]{1,255}$/;
const SAFE_OUTCOME = /^[a-z0-9_]{1,128}$/;

/* eslint-disable perfectionist/sort-classes, perfectionist/sort-modules */

interface Dependencies {
  em: EntityManager;
  env?: NodeJS.ProcessEnv;
  getDatabaseNow?: (em: EntityManager) => Promise<Date>;
}

export interface BankRecoveryClaim {
  claimToken: string;
  delivery: BankRecoveryDelivery;
  incident: BankSyncIncident;
}

export type BankRecoveryProviderOutcome =
  | { code: string; type: 'ambiguous' | 'pre_acceptance_permanent' | 'pre_acceptance_retryable' }
  | { messageId: string; type: 'accepted' };

export interface SendBankRecoveryClaimInput {
  claimToken: string;
  deliveryKey: number;
  send: (context: Readonly<{ appuser: Appuser; delivery: BankRecoveryDelivery; incident: BankSyncIncident; signal: AbortSignal }>) => Promise<BankRecoveryProviderOutcome>;
  timeoutMs: number;
}

export type SendBankRecoveryClaimResult =
  | { authorized: false; reason: string; shouldRetry: false }
  | { authorized: true; outcome: BankRecoveryProviderOutcome; shouldRetry: boolean };

type LockedAuthorization =
  | { appuser: Appuser; authorized: true }
  | { authorized: false; reason: string; shouldRetry: false };

interface AcceptedEvidence {
  authorizationBasis: BankRecoveryAuthorizationBasis;
  consentPolicyVersion: string;
  language: SupportedLanguages;
  messageId: string;
}

export class BankRecoveryService {
  private readonly em: EntityManager;
  private readonly env: NodeJS.ProcessEnv;
  private readonly getDatabaseNow: (em: EntityManager) => Promise<Date>;

  constructor(dependencies: Dependencies) {
    this.em = dependencies.em;
    this.env = dependencies.env ?? process.env;
    this.getDatabaseNow = dependencies.getDatabaseNow ?? databaseNow;
  }

  async listDuePending(limit = 100): Promise<BankRecoveryDelivery[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid bank recovery delivery limit');
    const now = await this.getDatabaseNow(this.em);
    return this.em.find(BankRecoveryDelivery, {
      attemptCount: { $lt: MAX_PROVIDER_ATTEMPTS },
      eligibleAfter: { $lte: now },
      status: BankRecoveryDeliveryStatus.PENDING,
    }, { limit, orderBy: { bankRecoveryDeliveryKey: 'asc', eligibleAfter: 'asc' } });
  }

  async markStaleClaimsNeedsReconciliation(): Promise<number> {
    const now = await this.getDatabaseNow(this.em);
    const staleCandidates = await this.em.find(BankRecoveryDelivery, {
      claimExpiresAt: { $lte: now }, status: BankRecoveryDeliveryStatus.CLAIMED,
    }, { fields: ['bankRecoveryDeliveryKey'], limit: 100, orderBy: { bankRecoveryDeliveryKey: 'asc' } });
    let count = 0;
    for (const candidate of staleCandidates) {
      count += await this.em.transactional(async (em) => {
        const { delivery } = await this.lockIncidentAndDelivery(em, candidate.bankRecoveryDeliveryKey);
        if (delivery.status !== BankRecoveryDeliveryStatus.CLAIMED || !delivery.claimExpiresAt || delivery.claimExpiresAt > now) return 0;
        delivery.completedAt = now;
        delivery.outcomeCode = 'stale_claim';
        delivery.status = BankRecoveryDeliveryStatus.NEEDS_RECONCILIATION;
        await em.flush();
        return 1;
      });
    }
    return count;
  }

  async claim(deliveryKey: number, jobId: string, leaseMs: number): Promise<BankRecoveryClaim | null> {
    if (!jobId || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('Invalid bank recovery claim');
    return this.em.transactional(async (em) => {
      const { delivery, incident } = await this.lockIncidentAndDelivery(em, deliveryKey);
      const now = await this.getDatabaseNow(em);
      if (delivery.status !== BankRecoveryDeliveryStatus.PENDING || delivery.eligibleAfter > now
        || delivery.attemptCount >= MAX_PROVIDER_ATTEMPTS) return null;
      if (!incident) {
        delivery.completedAt = now;
        delivery.outcomeCode = 'incident_missing';
        delivery.status = BankRecoveryDeliveryStatus.SUPPRESSED;
        await em.flush();
        return null;
      }
      const rolloutMode = this.currentAuthorizedMode(incident.distinctId);
      if (!rolloutMode) {
        delivery.completedAt = now;
        delivery.outcomeCode = 'rollout_ineligible';
        delivery.status = BankRecoveryDeliveryStatus.SUPPRESSED;
        await em.flush();
        return null;
      }
      const claimToken = randomUUID();
      delivery.attemptCount += 1;
      delivery.claimedAt = now;
      delivery.claimExpiresAt = new Date(now.getTime() + leaseMs);
      delivery.claimJobId = jobId;
      delivery.claimToken = claimToken;
      delivery.rolloutModeAtClaim = rolloutMode;
      delivery.status = BankRecoveryDeliveryStatus.CLAIMED;
      await em.flush();
      return { claimToken, delivery, incident };
    });
  }

  async sendClaim(input: SendBankRecoveryClaimInput): Promise<SendBankRecoveryClaimResult> {
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60_000) throw new Error('Invalid bank recovery provider timeout');
    let acceptedEvidence: AcceptedEvidence | undefined;
    let acceptedOutcome: Extract<BankRecoveryProviderOutcome, { type: 'accepted' }> | undefined;
    try {
      return await this.em.transactional(async (em) => {
        const { delivery, incident } = await this.lockClaim(em, input.deliveryKey, input.claimToken);
        if (!incident) return this.suppress(em, delivery, 'incident_missing');
        const authorization = await this.authorizeLocked(em, delivery, incident);
        if (!authorization.authorized) return authorization;

        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<BankRecoveryProviderOutcome>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ code: 'provider_timeout', type: 'ambiguous' });
          }, input.timeoutMs);
        });
        let outcome: BankRecoveryProviderOutcome;
        try {
          outcome = await Promise.race([input.send({ appuser: authorization.appuser, delivery, incident, signal: controller.signal }), timeout]);
        } catch {
          outcome = { code: 'provider_callback_error', type: 'ambiguous' };
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (outcome.type === 'accepted') {
          this.assertProviderIdentifiers(outcome);
          if (!delivery.authorizationBasis || !delivery.consentPolicyVersionAtSend || !delivery.languageAtSend) throw new Error('Bank recovery claim was not authorized');
          acceptedOutcome = outcome;
          acceptedEvidence = {
            authorizationBasis: delivery.authorizationBasis,
            consentPolicyVersion: delivery.consentPolicyVersionAtSend,
            language: delivery.languageAtSend,
            messageId: outcome.messageId,
          };
        }
        this.applyProviderOutcome(delivery, outcome, await this.getDatabaseNow(em));
        await em.flush();
        return {
          authorized: true,
          outcome,
          shouldRetry: outcome.type === 'pre_acceptance_retryable'
            && delivery.status === BankRecoveryDeliveryStatus.PENDING
            && delivery.attemptCount < MAX_PROVIDER_ATTEMPTS,
        };
      });
    } catch (error) {
      if (!acceptedEvidence || !acceptedOutcome) throw error;
      try {
        await this.persistAcceptedDatabaseUnknown(input.deliveryKey, input.claimToken, acceptedEvidence);
      } catch {
        // The original claim remains committed and expires into stale reconciliation.
      }
      return { authorized: true, outcome: acceptedOutcome, shouldRetry: false };
    }
  }

  private applyProviderOutcome(delivery: BankRecoveryDelivery, outcome: BankRecoveryProviderOutcome, now: Date): void {
    if (outcome.type === 'accepted') {
      this.assertProviderIdentifiers(outcome);
      if (!delivery.authorizationBasis || !delivery.consentPolicyVersionAtSend || !delivery.languageAtSend) throw new Error('Bank recovery claim was not authorized');
      delivery.completedAt = now;
      delivery.outcomeCode = 'sent';
      delivery.providerMessageId = outcome.messageId;
      delivery.sentAt = now;
      delivery.status = BankRecoveryDeliveryStatus.SENT;
      return;
    }
    if (!SAFE_OUTCOME.test(outcome.code)) throw new Error('Unsafe bank recovery outcome code');
    delivery.outcomeCode = outcome.code;
    if (outcome.type === 'pre_acceptance_retryable' && delivery.attemptCount < MAX_PROVIDER_ATTEMPTS) {
      clearClaim(delivery);
      delivery.status = BankRecoveryDeliveryStatus.PENDING;
      return;
    }
    delivery.completedAt = now;
    if (outcome.type === 'ambiguous') delivery.status = BankRecoveryDeliveryStatus.NEEDS_RECONCILIATION;
    else delivery.status = BankRecoveryDeliveryStatus.FAILED;
  }

  private assertProviderIdentifiers(provider: { messageId: string }): void {
    if (!SAFE_PROVIDER_ID.test(provider.messageId)) throw new Error('Unsafe provider identifier');
  }

  private async authorizeLocked(em: EntityManager, delivery: BankRecoveryDelivery, incident: BankSyncIncident): Promise<LockedAuthorization> {
    if (incident.finality === BankSyncFinality.TERMINAL_SUCCESS) return this.suppress(em, delivery, 'same_incident_success');
    const rolloutMode = this.currentAuthorizedMode(incident.distinctId);
    if (!rolloutMode) return this.suppress(em, delivery, 'rollout_ineligible');
    const appuser = await em.findOne(Appuser, { appuserKey: relationId(incident.appuserKey, 'appuserKey'), deletedAt: undefined, recordActive: true }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!appuser) return this.suppress(em, delivery, 'inactive_appuser');
    if (incident.distinctId !== appuser.externalUserId) return this.suppress(em, delivery, 'identity_mismatch');
    if (appuser.marketingOptOut) return this.suppress(em, delivery, 'marketing_opt_out');
    const prefs = await em.findOne(EmailNotificationPreference, { appuserKey: appuser, deletedAt: null });
    if (!categoryEnabled(prefs, EmailCategory.ACCOUNT_RECOVERY)) return this.suppress(em, delivery, 'account_recovery_disabled');
    const language = appuser.language as string;
    if (language !== 'EN' && language !== 'PT') return this.suppress(em, delivery, 'unsupported_language');
    // Re-resolved under the send locks: this is the mode that actually
    // authorizes the provider call, not the historical enrollment treatment.
    delivery.rolloutModeAtClaim = rolloutMode;
    delivery.authorizationBasis = BankRecoveryAuthorizationBasis.LIFECYCLE_CONSENT;
    delivery.consentPolicyVersionAtSend = LIFECYCLE_EMAIL_AUTHORIZATION_POLICY_VERSION;
    delivery.languageAtSend = appuser.language;
    await em.flush();
    return { appuser, authorized: true };
  }

  private async lockDelivery(em: EntityManager, deliveryKey: number): Promise<BankRecoveryDelivery> {
    const delivery = await em.findOne(BankRecoveryDelivery, { bankRecoveryDeliveryKey: deliveryKey }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!delivery) throw new Error('Bank recovery delivery was not found');
    return delivery;
  }

  private async lockIncidentAndDelivery(em: EntityManager, deliveryKey: number): Promise<{ delivery: BankRecoveryDelivery; incident: BankSyncIncident | null }> {
    const candidate = await em.findOne(BankRecoveryDelivery, { bankRecoveryDeliveryKey: deliveryKey });
    if (!candidate) throw new Error('Bank recovery delivery was not found');
    const incidentKey = relationId(candidate.incidentKey, 'bankSyncIncidentKey');
    const incident = await em.findOne(BankSyncIncident, { bankSyncIncidentKey: incidentKey, deletedAt: undefined }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    const delivery = await this.lockDelivery(em, deliveryKey);
    if (relationId(delivery.incidentKey, 'bankSyncIncidentKey') !== incidentKey) throw new Error('Bank recovery delivery incident changed');
    return { delivery, incident };
  }

  private async lockClaim(em: EntityManager, deliveryKey: number, claimToken: string): Promise<{ delivery: BankRecoveryDelivery; incident: BankSyncIncident | null }> {
    const { delivery, incident } = await this.lockIncidentAndDelivery(em, deliveryKey);
    if (delivery.status !== BankRecoveryDeliveryStatus.CLAIMED || delivery.claimToken !== claimToken) throw new Error('Bank recovery claim token mismatch');
    return { delivery, incident };
  }

  private currentAuthorizedMode(externalUserId: string | undefined): BankRecoveryTreatmentMode | null {
    // Bank recovery is live with no gating: any delivery whose incident owner has a
    // resolvable external identity is authorized. `externalUserId` is required
    // because downstream identity matching depends on it.
    if (!externalUserId) return null;
    return BankRecoveryTreatmentMode.LIVE;
  }

  private async persistAcceptedDatabaseUnknown(deliveryKey: number, claimToken: string, evidence: AcceptedEvidence): Promise<void> {
    await this.em.transactional(async (em) => {
      const { delivery } = await this.lockClaim(em, deliveryKey, claimToken);
      delivery.authorizationBasis = evidence.authorizationBasis;
      delivery.completedAt = await this.getDatabaseNow(em);
      delivery.consentPolicyVersionAtSend = evidence.consentPolicyVersion;
      delivery.languageAtSend = evidence.language;
      delivery.outcomeCode = 'provider_accepted_db_unknown';
      delivery.providerMessageId = evidence.messageId;
      delivery.status = BankRecoveryDeliveryStatus.NEEDS_RECONCILIATION;
      await em.flush();
    });
  }

  private async suppress(em: EntityManager, delivery: BankRecoveryDelivery, reason: string): Promise<{ authorized: false; reason: string; shouldRetry: false }> {
    delivery.completedAt = await this.getDatabaseNow(em);
    delivery.outcomeCode = reason;
    delivery.status = BankRecoveryDeliveryStatus.SUPPRESSED;
    await em.flush();
    return { authorized: false, reason, shouldRetry: false };
  }
}

function clearClaim(delivery: BankRecoveryDelivery): void {
  delivery.claimedAt = undefined;
  delivery.claimExpiresAt = undefined;
  delivery.claimJobId = undefined;
  delivery.claimToken = undefined;
  delivery.rolloutModeAtClaim = undefined;
}

function relationId(relation: unknown, primaryKey: 'appuserKey' | 'bankSyncIncidentKey'): number {
  const unwrapped: unknown = typeof relation === 'object' && relation !== null
    ? Reference.unwrapReference(relation)
    : relation;
  const value = typeof unwrapped === 'number'
    ? unwrapped
    : typeof unwrapped === 'object' && unwrapped !== null
      ? (unwrapped as Record<string, unknown>)[primaryKey]
      : undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid bank recovery relation ID');
  }
  return value;
}

async function databaseNow(em: EntityManager): Promise<Date> {
  const rows = await em.getConnection().execute<{ now: Date | string }[]>('select clock_timestamp() as now', [], 'all', em.getTransactionContext());
  const value = rows[0]?.now;
  if (!value) throw new Error('Database did not return current time');
  return value instanceof Date ? value : new Date(value);
}

/* eslint-enable perfectionist/sort-classes, perfectionist/sort-modules */
