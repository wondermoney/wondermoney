import { type EntityManager, Reference } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { BankRecoveryDelivery, BankRecoveryDeliveryStatus, BankRecoveryTreatmentMode } from '@entity/BankRecoveryDelivery';
import { BankSyncEnvironment, BankSyncFinality, BankSyncIncident } from '@entity/BankSyncIncident';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { BankRecoveryService } from '@service/bank-sync/bank-recovery.service';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */

const NOW = new Date('2026-07-16T11:05:00Z');
const EXTERNAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function harness(overrides: { accountRecoveryEnabled?: boolean; delivery?: any; incident?: any; missingIncident?: boolean; user?: any } = {}, env: NodeJS.ProcessEnv = {}) {
  const incident = Object.assign(new BankSyncIncident(), {
    appuserKey: 7, bankSyncIncidentKey: 9, distinctId: EXTERNAL_ID,
    environment: BankSyncEnvironment.PRODUCTION, finality: BankSyncFinality.TERMINAL_FAILURE,
  }, overrides.incident);
  const delivery = Object.assign(new BankRecoveryDelivery(), {
    attemptCount: 0, bankRecoveryDeliveryKey: 3, eligibleAfter: new Date('2026-07-16T11:00:00Z'),
    incidentKey: incident, status: BankRecoveryDeliveryStatus.PENDING,
    templateVersion: 'bank-recovery.v1', treatmentMode: BankRecoveryTreatmentMode.INTERNAL_ALLOWLIST,
  }, overrides.delivery);
  const user = Object.assign(new Appuser(), {
    appuserKey: 7, externalUserId: EXTERNAL_ID, language: SupportedLanguages.EN, recordActive: true,
  }, overrides.user);
  const preference = overrides.accountRecoveryEnabled === undefined ? null : Object.assign(new EmailNotificationPreference(), { accountRecoveryEnabled: overrides.accountRecoveryEnabled });
  const rows = [delivery];
  const lockOrder: string[] = [];
  const tx = {
    find: vi.fn(async () => rows),
    findOne: vi.fn(async (type: unknown, _where: unknown, options?: { lockMode?: unknown }) => {
      if (options?.lockMode) lockOrder.push(type === BankRecoveryDelivery ? 'delivery' : type === BankSyncIncident ? 'incident' : 'appuser');
      if (type === EmailNotificationPreference) return preference;
      return type === BankRecoveryDelivery ? delivery : type === BankSyncIncident ? (overrides.missingIncident ? null : incident) : type === Appuser ? user : null;
    }),
    flush: vi.fn(),
    upsert: vi.fn(),
  };
  const em = {
    find: tx.find,
    findOne: tx.findOne,
    flush: tx.flush,
    transactional: vi.fn(async (work: (manager: any) => unknown) => work(tx)),
    upsert: tx.upsert,
  };
  const service = new BankRecoveryService({ em: em as unknown as EntityManager, env, getDatabaseNow: vi.fn(async () => NOW) });
  return { delivery, em, incident, lockOrder, service, tx, user };
}

function mikroReference<T extends object>(entity: T, primaryKey: keyof T): Reference<T> {
  Object.defineProperty(entity, '__helper', {
    configurable: true,
    value: { __meta: { primaryKeys: [primaryKey] }, __reference: undefined },
  });
  return new Reference(entity);
}

describe('BankRecoveryService', () => {
  it('lists pending rows at the exact DB-time boundary and never synthesizes templates', async () => {
    const h = harness();
    await h.service.listDuePending(25);
    expect(h.em.find).toHaveBeenCalledWith(BankRecoveryDelivery, expect.objectContaining({ eligibleAfter: { $lte: NOW }, status: BankRecoveryDeliveryStatus.PENDING }), expect.objectContaining({ limit: 25 }));
    expect(h.tx.upsert).not.toHaveBeenCalled();
  });

  it('claims atomically with a token and enforces two total provider attempts', async () => {
    const h = harness({}, { APP_ENV: 'production', BANK_RECOVERY_MODE: 'live' });
    const first = await h.service.claim(3, 'job-1', 60_000);
    expect(first?.claimToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.delivery).toMatchObject({ attemptCount: 1, claimJobId: 'job-1', status: BankRecoveryDeliveryStatus.CLAIMED });
    expect(await h.service.claim(3, 'job-2', 60_000)).toBeNull();
    Object.assign(h.delivery, { attemptCount: 2, claimToken: undefined, status: BankRecoveryDeliveryStatus.PENDING });
    expect(await h.service.claim(3, 'job-3', 60_000)).toBeNull();
  });

  // The RAD-178 rollout gate was removed: a claim always records LIVE as the
  // authorizing mode, regardless of the retired BANK_RECOVERY_MODE flag, the app
  // env, or the delivery's historical enrollment treatment.
  it.each([
    ['production live env', { APP_ENV: 'production', BANK_RECOVERY_MODE: 'live' }],
    ['staging with the flag off', { APP_ENV: 'staging', BANK_RECOVERY_MODE: 'off' }],
    ['no rollout env at all', {}],
  ])('records LIVE as the authorizing mode on claim regardless of %s', async (_name, env) => {
    const h = harness({ delivery: { treatmentMode: BankRecoveryTreatmentMode.INTERNAL_ALLOWLIST } }, env);
    await expect(h.service.claim(3, 'job-1', 60_000)).resolves.toBeTruthy();
    expect(h.delivery.rolloutModeAtClaim).toBe(BankRecoveryTreatmentMode.LIVE);
  });

  it.each([
    ['the flag off', { BANK_RECOVERY_MODE: 'off' }],
    ['no flag', {}],
    ['staging live', { APP_ENV: 'staging', BANK_RECOVERY_MODE: 'live' }],
  ])('claims regardless of the retired rollout flag (%s)', async (_name, env) => {
    const h = harness({}, env);
    await expect(h.service.claim(3, 'job-1', 60_000)).resolves.toBeTruthy();
    expect(h.delivery).toMatchObject({ attemptCount: 1, status: BankRecoveryDeliveryStatus.CLAIMED });
  });

  it('suppresses without a claim when the incident owner has no external identity', async () => {
    const h = harness({ incident: { distinctId: undefined } });
    await expect(h.service.claim(3, 'job-1', 60_000)).resolves.toBeNull();
    expect(h.delivery).toMatchObject({ attemptCount: 0, outcomeCode: 'rollout_ineligible', status: BankRecoveryDeliveryStatus.SUPPRESSED });
    expect(h.delivery.claimToken).toBeUndefined();
  });

  it('moves stale claims to reconciliation, never pending', async () => {
    const h = harness({ delivery: { claimExpiresAt: NOW, claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } });
    expect(await h.service.markStaleClaimsNeedsReconciliation()).toBe(1);
    expect(h.delivery).toMatchObject({ outcomeCode: 'stale_claim', status: BankRecoveryDeliveryStatus.NEEDS_RECONCILIATION });
  });

  it('reconciles at most 100 ordered stale claims per dispatch in separate transactions', async () => {
    const incident = Object.assign(new BankSyncIncident(), { bankSyncIncidentKey: 9 });
    const deliveries = Array.from({ length: 101 }, (_, index) => Object.assign(new BankRecoveryDelivery(), {
      bankRecoveryDeliveryKey: index + 1, claimExpiresAt: NOW, incidentKey: incident, status: BankRecoveryDeliveryStatus.CLAIMED,
    }));
    const tx = {
      findOne: vi.fn(async (type: unknown, where: any) => type === BankSyncIncident
        ? incident
        : deliveries.find((delivery) => delivery.bankRecoveryDeliveryKey === where.bankRecoveryDeliveryKey) ?? null),
      flush: vi.fn(),
    };
    const em = {
      find: vi.fn(async (_type: unknown, _where: unknown, options: { limit: number }) => deliveries
        .filter((delivery) => delivery.status === BankRecoveryDeliveryStatus.CLAIMED).slice(0, options.limit)),
      transactional: vi.fn(async (work: (manager: any) => unknown) => work(tx)),
    };
    const service = new BankRecoveryService({ em: em as unknown as EntityManager, getDatabaseNow: vi.fn(async () => NOW) });
    await expect(service.markStaleClaimsNeedsReconciliation()).resolves.toBe(100);
    expect(em.transactional).toHaveBeenCalledTimes(100);
    expect(deliveries[100]?.status).toBe(BankRecoveryDeliveryStatus.CLAIMED);
    await expect(service.markStaleClaimsNeedsReconciliation()).resolves.toBe(1);
    expect(em.transactional).toHaveBeenCalledTimes(101);
  });

  it('suppresses a pending delivery when its incident is missing before committing a claim', async () => {
    const h = harness({ missingIncident: true });
    await expect(h.service.claim(3, 'job-1', 60_000)).resolves.toBeNull();
    expect(h.delivery).toMatchObject({ attemptCount: 0, outcomeCode: 'incident_missing', status: BankRecoveryDeliveryStatus.SUPPRESSED });
    expect(h.delivery.claimToken).toBeUndefined();
  });

  it.each([
    ['marketing opt-out', { user: { marketingOptOut: NOW } }, 'marketing_opt_out'],
    ['same incident success', { incident: { finality: BankSyncFinality.TERMINAL_SUCCESS } }, 'same_incident_success'],
    ['identity mismatch', { user: { externalUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }, 'identity_mismatch'],
  ])('suppresses %s before provider acceptance', async (_name, overrides, reason) => {
    const h = harness({ ...overrides, delivery: { claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    const send = vi.fn();
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send, timeoutMs: 1000 })).resolves.toEqual({ authorized: false, reason, shouldRetry: false });
    expect(send).not.toHaveBeenCalled();
    expect(h.delivery.status).toBe(BankRecoveryDeliveryStatus.SUPPRESSED);
  });

  it('suppresses when account-recovery category emails are disabled, keeping the marketing-opt-out check intact', async () => {
    const h = harness({ accountRecoveryEnabled: false, delivery: { claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    const send = vi.fn();
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send, timeoutMs: 1000 }))
      .resolves.toEqual({ authorized: false, reason: 'account_recovery_disabled', shouldRetry: false });
    expect(send).not.toHaveBeenCalled();
    expect(h.delivery.status).toBe(BankRecoveryDeliveryStatus.SUPPRESSED);
  });

  // Rollout-based suppression (off / allowlist exclusion / live-outside-prod) is
  // gone; the surviving pre-send suppressions are identity- and consent-based.
  it.each([
    ['an unsupported locale', { user: { language: 'ES' } }, 'unsupported_language'],
    ['an owner with no external identity', { incident: { distinctId: undefined } }, 'rollout_ineligible'],
  ])('suppresses %s without invoking the callback', async (_name, overrides, reason) => {
    const h = harness({ ...overrides, delivery: { claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {});
    const send = vi.fn();
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send, timeoutMs: 1000 }))
      .resolves.toEqual({ authorized: false, reason, shouldRetry: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends under incident-delivery-user-consent locks and persists the structural outcome atomically', async () => {
    const h = harness({ delivery: { attemptCount: 1, claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    const send = vi.fn(async () => ({ messageId: 'msg_1', type: 'accepted' as const }));
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send, timeoutMs: 1000 }))
      .resolves.toMatchObject({ outcome: { type: 'accepted' } });
    expect(h.lockOrder).toEqual(['incident', 'delivery', 'appuser']);
    expect(send).toHaveBeenCalledOnce();
    expect(h.delivery).toMatchObject({ providerMessageId: 'msg_1', status: BankRecoveryDeliveryStatus.SENT });
  });

  it('extracts incident and appuser IDs from real MikroORM Reference wrappers', async () => {
    const h = harness({ delivery: { claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    h.delivery.incidentKey = mikroReference(h.incident, 'bankSyncIncidentKey');
    h.incident.appuserKey = mikroReference(h.user, 'appuserKey');

    await expect(h.service.sendClaim({
      claimToken: 'token', deliveryKey: 3,
      send: vi.fn(async () => ({ messageId: 'msg_ref', type: 'accepted' as const })),
      timeoutMs: 1000,
    })).resolves.toMatchObject({ authorized: true, outcome: { type: 'accepted' } });
    expect(h.tx.findOne).toHaveBeenCalledWith(Appuser, expect.objectContaining({ appuserKey: 7 }), expect.anything());
  });

  it.each([0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1, {}])('fails closed for invalid incident relation ID %s', async (incidentKey) => {
    const h = harness({ delivery: { incidentKey } });
    await expect(h.service.claim(3, 'job-1', 60_000)).rejects.toThrow('Invalid bank recovery relation');
  });

  it('fails closed for an invalid appuser relation ID', async () => {
    const h = harness({
      delivery: { claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED },
      incident: { appuserKey: Number.NaN },
    }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send: vi.fn(), timeoutMs: 1000 }))
      .rejects.toThrow('Invalid bank recovery relation');
  });

  it('takes the database outcome timestamp after provider completion', async () => {
    const order: string[] = [];
    const h = harness({ delivery: { attemptCount: 1, claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    (h.service as any).getDatabaseNow = vi.fn(async () => { order.push('database-now'); return NOW; });
    await h.service.sendClaim({
      claimToken: 'token', deliveryKey: 3,
      send: vi.fn(async () => { order.push('provider-complete'); return { messageId: 'msg', type: 'accepted' as const }; }),
      timeoutMs: 1000,
    });
    expect(order).toEqual(['provider-complete', 'database-now']);
  });

  it('uses PostgreSQL statement time for database timestamps', async () => {
    const execute = vi.fn(async () => [{ now: NOW }]);
    const em = {
      find: vi.fn(),
      getConnection: vi.fn(() => ({ execute })),
      getTransactionContext: vi.fn(() => 'tx'),
    };
    const service = new BankRecoveryService({ em: em as unknown as EntityManager });
    await service.listDuePending();
    expect(execute).toHaveBeenCalledWith('select clock_timestamp() as now', [], 'all', 'tx');
  });

  it.each([
    [{ code: 'busy', type: 'pre_acceptance_retryable' as const }, BankRecoveryDeliveryStatus.PENDING],
    [{ code: 'rejected', type: 'pre_acceptance_permanent' as const }, BankRecoveryDeliveryStatus.FAILED],
    [{ code: 'timeout', type: 'ambiguous' as const }, BankRecoveryDeliveryStatus.NEEDS_RECONCILIATION],
  ])('persists provider outcome $type', async (outcome, status) => {
    const h = harness({ delivery: { attemptCount: 1, claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    await h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send: vi.fn(async () => outcome), timeoutMs: 1000 });
    expect(h.delivery.status).toBe(status);
  });

  it('has no public split-send or accepted-evidence fabrication methods', () => {
    expect(BankRecoveryService.prototype).not.toHaveProperty('ensureIntent');
    expect(BankRecoveryService.prototype).not.toHaveProperty('releasePreAcceptanceRetry');
    expect(BankRecoveryService.prototype).not.toHaveProperty('markFailedPermanent');
    expect(BankRecoveryService.prototype).not.toHaveProperty('markAmbiguousNeedsReconciliation');
    expect(BankRecoveryService.prototype).not.toHaveProperty('authorizeClaim');
    expect(BankRecoveryService.prototype).not.toHaveProperty('markSent');
    expect(BankRecoveryService.prototype).not.toHaveProperty('reconcileAcceptedButDatabaseUnknown');
  });

  // With the gate removed, send authorizes as LIVE for every claim with a
  // resolvable owner — independent of the retired env flag and of the delivery's
  // historical enrollment treatment (no historical-equality requirement).
  it.each([
    ['a historical allowlist enrollment in a live-prod env', BankRecoveryTreatmentMode.INTERNAL_ALLOWLIST, { APP_ENV: 'production', BANK_RECOVERY_MODE: 'live' }],
    ['a historical live enrollment with the flag off', BankRecoveryTreatmentMode.LIVE, { BANK_RECOVERY_MODE: 'off' }],
    ['no env flag at all', BankRecoveryTreatmentMode.INTERNAL_ALLOWLIST, {}],
  ])('authorizes send as LIVE regardless of %s', async (_name, treatmentMode, env) => {
    const h = harness({ delivery: { claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED, treatmentMode } }, {
      ...env,
    });
    const send = vi.fn(async () => ({ messageId: 'msg', type: 'accepted' as const }));
    const result = await h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send, timeoutMs: 1000 });
    expect(result.authorized).toBe(true);
    expect(h.delivery.rolloutModeAtClaim).toBe(BankRecoveryTreatmentMode.LIVE);
  });

  it('reconciles an accepted provider response when the sending transaction commit fails', async () => {
    const h = harness({ delivery: { attemptCount: 1, claimedAt: NOW, claimExpiresAt: new Date(NOW.getTime() + 60_000), claimJobId: 'job', claimToken: 'token', rolloutModeAtClaim: BankRecoveryTreatmentMode.INTERNAL_ALLOWLIST, status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    h.em.transactional.mockImplementationOnce(async (work: (manager: any) => unknown) => {
      await work(h.tx);
      Object.assign(h.delivery, {
        authorizationBasis: undefined, completedAt: undefined, consentPolicyVersionAtSend: undefined,
        languageAtSend: undefined, outcomeCode: undefined, providerMessageId: undefined,
        sentAt: undefined, status: BankRecoveryDeliveryStatus.CLAIMED,
      });
      throw new Error('commit failed');
    });
    const send = vi.fn(async () => ({ messageId: 'msg_accepted', type: 'accepted' as const }));
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send, timeoutMs: 1000 }))
      .resolves.toEqual({ authorized: true, outcome: { messageId: 'msg_accepted', type: 'accepted' }, shouldRetry: false });
    expect(send).toHaveBeenCalledOnce();
    expect(h.em.transactional).toHaveBeenCalledTimes(2);
    expect(h.delivery).toMatchObject({
      authorizationBasis: 'lifecycle_consent', consentPolicyVersionAtSend: 'lifecycle.v1', languageAtSend: SupportedLanguages.EN,
      outcomeCode: 'provider_accepted_db_unknown', providerMessageId: 'msg_accepted',
      status: BankRecoveryDeliveryStatus.NEEDS_RECONCILIATION,
    });
  });

  it('returns accepted and leaves the claim stale when both commit and reconciliation persistence fail', async () => {
    const h = harness({ delivery: { attemptCount: 1, claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    h.em.transactional.mockImplementationOnce(async (work: (manager: any) => unknown) => {
      await work(h.tx);
      Object.assign(h.delivery, { authorizationBasis: undefined, completedAt: undefined, consentPolicyVersionAtSend: undefined, languageAtSend: undefined, outcomeCode: undefined, providerMessageId: undefined, sentAt: undefined, status: BankRecoveryDeliveryStatus.CLAIMED });
      throw new Error('commit failed');
    }).mockRejectedValueOnce(new Error('reconciliation commit failed'));
    const outcome = { messageId: 'msg_accepted', type: 'accepted' as const };
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send: vi.fn(async () => outcome), timeoutMs: 1000 }))
      .resolves.toEqual({ authorized: true, outcome, shouldRetry: false });
    expect(h.delivery.status).toBe(BankRecoveryDeliveryStatus.CLAIMED);
  });

  it('reports a queue retry only for a durably pending proven pre-acceptance failure with attempts remaining', async () => {
    const h = harness({ delivery: { attemptCount: 1, claimToken: 'token', status: BankRecoveryDeliveryStatus.CLAIMED } }, {
      BANK_RECOVERY_MODE: 'internal-allowlist', GROWTH_INTERNAL_ALLOWLIST_EXTERNAL_USER_IDS: EXTERNAL_ID,
    });
    const retryable = { code: 'provider_rate_limited', type: 'pre_acceptance_retryable' as const };
    await expect(h.service.sendClaim({ claimToken: 'token', deliveryKey: 3, send: vi.fn(async () => retryable), timeoutMs: 1000 }))
      .resolves.toEqual({ authorized: true, outcome: retryable, shouldRetry: true });

    Object.assign(h.delivery, { attemptCount: 2, claimToken: 'second', status: BankRecoveryDeliveryStatus.CLAIMED });
    await expect(h.service.sendClaim({ claimToken: 'second', deliveryKey: 3, send: vi.fn(async () => retryable), timeoutMs: 1000 }))
      .resolves.toEqual({ authorized: true, outcome: retryable, shouldRetry: false });
    expect(h.delivery.status).toBe(BankRecoveryDeliveryStatus.FAILED);
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
