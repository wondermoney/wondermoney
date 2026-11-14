import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { type TestDatabase, useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { deterministicRequisitionContext } from '@app/analytics/bank-sync-contract';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { BankSyncFinality, BankSyncFlow, BankSyncIncident, BankSyncResult, BankSyncRolloutMode } from '@entity/BankSyncIncident';
import { BankSyncAttemptResult, BankSyncIncidentAttempt } from '@entity/BankSyncIncidentAttempt';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { getBankSyncHealth, listFailingBankConnections } from '@service/bank-sync/bank-sync-health.service';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

interface AttemptInput {
  at: Date;
  errorCode?: string;
  institutionId?: string;
  result: BankSyncAttemptResult;
}

interface ConnectionInput {
  bank?: string;
  country?: string;
  deleted?: boolean;
  status?: BankConnectionStatus;
}

/** A linked Enable Banking connection: the provider-agnostic row and its detail row. */
async function connect(db: TestDatabase, household: Household, input: ConnectionInput = {}) {
  const em = db.em();
  const sessionId = `session-${randomUUID()}`;
  const status = input.status ?? BankConnectionStatus.LINKED;
  const credential = em.create(EnableBankingCredential, {
    applicationId: `app-${randomUUID()}`, appuserKey: household.appuser, encryptionKeyVersion: 1,
    privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant,
  }, { partial: true });
  const bankConnection = em.create(BankConnection, {
    appuserKey: household.appuser, deletedAt: input.deleted ? hoursAgo(1) : undefined, externalId: sessionId,
    provider: 'enable_banking', state: `state-${randomUUID()}`, status, tenantKey: household.tenant,
  }, { partial: true });
  em.create(EnableBankingConnection, {
    appuserKey: household.appuser, aspspCountry: input.country ?? 'PT', aspspName: input.bank ?? 'Example Bank',
    bankConnectionKey: bankConnection, enableBankingCredentialKey: credential, sessionId, state: `eb-state-${randomUUID()}`,
    status: status as unknown as EnableBankingConnectionStatus, tenantKey: household.tenant,
  }, { partial: true });
  await em.flush();
  return { requisitionId: sessionId };
}


/** One sync run (incident) with its attempts, in order. */
async function run(db: TestDatabase, household: Household, connection: { requisitionId: string }, attempts: AttemptInput[]) {
  const em = db.em();
  const last = attempts.at(-1);
  const incident = em.create(BankSyncIncident, {
    appuserKey: household.appuser,
    attempts: attempts.length,
    correlationId: `account.auto-sync.requisition:${randomUUID()}`,
    errorCode: last?.errorCode,
    finality: last?.result === BankSyncAttemptResult.FULL_SUCCESS ? BankSyncFinality.TERMINAL_SUCCESS : BankSyncFinality.TERMINAL_FAILURE,
    flow: BankSyncFlow.SCHEDULED_REFRESH,
    incidentId: randomUUID(),
    requisitionId: connection.requisitionId,
    result: last?.result === BankSyncAttemptResult.FULL_SUCCESS ? BankSyncResult.SUCCESS : BankSyncResult.FAILURE,
    rolloutMode: BankSyncRolloutMode.OFF,
  }, { partial: true });
  attempts.forEach((attempt, index) => {
    em.create(BankSyncIncidentAttempt, {
      attempt: index + 1,
      completedAt: attempt.at,
      errorCategory: attempt.errorCode ? 'provider' : undefined,
      errorCode: attempt.errorCode,
      incidentKey: incident,
      institutionId: attempt.institutionId,
      queueAttempt: index + 1,
      queueJobId: `job-${randomUUID()}`,
      requisitionContext: deterministicRequisitionContext(connection.requisitionId),
      result: attempt.result,
      startedAt: new Date(attempt.at.getTime() - 60_000),
    }, { partial: true });
  });
  await em.flush();
}

const ok = (hours: number): AttemptInput => ({ at: hoursAgo(hours), result: BankSyncAttemptResult.FULL_SUCCESS });
const failed = (hours: number, errorCode = 'provider_unavailable'): AttemptInput => ({ at: hoursAgo(hours), errorCode, result: BankSyncAttemptResult.FAILED });
const partial = (hours: number): AttemptInput => ({ at: hoursAgo(hours), errorCode: 'account_rejected', result: BankSyncAttemptResult.PARTIAL });

describe('bank sync health', () => {
  const db = useTestDatabase();

  it('counts live connections by status, leaving deleted ones out', async () => {
    const household = await seedHousehold(db.em());
    await connect(db, household);
    await connect(db, household);
    await connect(db, household, { status: BankConnectionStatus.EXPIRED });
    await connect(db, household, { status: BankConnectionStatus.ERROR });
    await connect(db, household, { deleted: true });

    const health = await getBankSyncHealth(db.em(), { now: NOW });

    expect(health.connections.byStatus).toEqual({ authorized: 0, created: 0, error: 1, expired: 1, linked: 2, revoked: 0 });
    expect(health.connections.total).toBe(4);
  });

  it('counts sync runs by error code over the last 24 hours and the last 7 days', async () => {
    const household = await seedHousehold(db.em());
    const connection = await connect(db, household);
    await run(db, household, connection, [failed(2, 'rate_limited')]);
    await run(db, household, connection, [failed(72, 'rate_limited')]);
    // Two attempts of one run with the same code are one incident.
    await run(db, household, connection, [failed(30, 'provider_unavailable'), failed(29, 'provider_unavailable')]);
    // Older than the window.
    await run(db, household, connection, [failed(24 * 8, 'consent_expired')]);
    await run(db, household, connection, [ok(1)]);

    const health = await getBankSyncHealth(db.em(), { now: NOW });

    expect(health.incidentsByErrorCode.last24Hours).toEqual([{ errorCode: 'rate_limited', incidents: 1 }]);
    expect(health.incidentsByErrorCode.last7Days).toEqual([
      { errorCode: 'rate_limited', incidents: 2 },
      { errorCode: 'provider_unavailable', incidents: 1 },
    ]);
  });

  it('gives each institution its success rate over 7 days and puts the failing one first, flagged', async () => {
    const household = await seedHousehold(db.em());
    const steady = await connect(db, household, { bank: 'Steady Bank' });
    const shaky = await connect(db, household, { bank: 'Shaky Bank', country: 'ES' });
    for (const hours of [10, 20, 30]) await run(db, household, steady, [ok(hours)]);
    await run(db, household, steady, [failed(40)]);
    await run(db, household, steady, [failed(24 * 9)]);
    await run(db, household, shaky, [ok(50)]);
    for (const hours of [5, 15, 25]) await run(db, household, shaky, [failed(hours)]);

    const health = await getBankSyncHealth(db.em(), { now: NOW });

    expect(health.institutions.map((entry) => entry.institution.name)).toEqual(['Shaky Bank', 'Steady Bank']);
    expect(health.institutions[0]).toMatchObject({
      attempts: 4, failed: 3, institution: { country: 'ES', id: 'enable_banking:es:shaky-bank', name: 'Shaky Bank' },
      needsAttention: true, partial: 0, provider: 'enable_banking', succeeded: 1, successRate: 0.25,
    });
    expect(health.institutions[1]).toMatchObject({ attempts: 4, failed: 1, needsAttention: false, succeeded: 3, successRate: 0.75 });
  });

  it('flags an institution with several connections failing for more than 48 hours', async () => {
    const household = await seedHousehold(db.em());
    const first = await connect(db, household, { bank: 'Broken Bank' });
    const second = await connect(db, household, { bank: 'Broken Bank' });
    await run(db, household, first, [failed(24 * 10, 'consent_expired')]);
    await run(db, household, second, [failed(24 * 10, 'consent_expired')]);

    const health = await getBankSyncHealth(db.em(), { now: NOW });

    expect(health.connections.failing).toBe(2);
    // No attempt in the last 7 days, but the bank is still listed, and stands out.
    expect(health.institutions).toEqual([expect.objectContaining({
      attempts: 0, failingConnections: 2, institution: expect.objectContaining({ name: 'Broken Bank' }), needsAttention: true, successRate: null,
    })]);
  });
});

describe('connections failing for more than 48 hours', () => {
  const db = useTestDatabase();

  it('lists a connection once its failures have lasted past the threshold, with its institution, code and last success', async () => {
    const household = await seedHousehold(db.em());
    const recent = await connect(db, household, { bank: 'Recent Bank' });
    const long = await connect(db, household, { bank: 'Long Bank' });
    await run(db, household, recent, [ok(60), failed(47), failed(10, 'rate_limited')]);
    await run(db, household, long, [ok(80), failed(49), failed(10, 'rate_limited')]);

    const { connections, thresholdHours } = await listFailingBankConnections(db.em(), { now: NOW });

    expect(thresholdHours).toBe(48);
    expect(connections).toEqual([{
      errorCode: 'rate_limited',
      failingSince: hoursAgo(49).toISOString(),
      institution: { country: 'PT', id: 'enable_banking:pt:long-bank', name: 'Long Bank' },
      lastAttemptAt: hoursAgo(10).toISOString(),
      lastSuccessAt: hoursAgo(80).toISOString(),
      provider: 'enable_banking',
      status: 'linked',
    }]);
  });

  it('counts a connection that never synced from its first failure', async () => {
    const household = await seedHousehold(db.em());
    const connection = await connect(db, household, { status: BankConnectionStatus.EXPIRED });
    await run(db, household, connection, [failed(72, 'consent_expired')]);

    const { connections } = await listFailingBankConnections(db.em(), { now: NOW });

    expect(connections).toEqual([expect.objectContaining({ errorCode: 'consent_expired', failingSince: hoursAgo(72).toISOString(), lastSuccessAt: null, status: 'expired' })]);
  });

  it('does not list a connection whose latest attempt succeeded, or whose partial sync restarted the clock', async () => {
    const household = await seedHousehold(db.em());
    const recovered = await connect(db, household);
    const partly = await connect(db, household);
    await run(db, household, recovered, [failed(100), failed(70), ok(5)]);
    await run(db, household, partly, [failed(100), partial(30), failed(5)]);

    const { connections } = await listFailingBankConnections(db.em(), { now: NOW });

    expect(connections).toEqual([]);
  });

  it('leaves out a deleted connection', async () => {
    const household = await seedHousehold(db.em());
    const connection = await connect(db, household, { deleted: true });
    await run(db, household, connection, [failed(100)]);

    expect((await listFailingBankConnections(db.em(), { now: NOW })).connections).toEqual([]);
    expect((await getBankSyncHealth(db.em(), { now: NOW })).connections.failing).toBe(0);
  });

  it('puts the institution with the most failing connections first', async () => {
    const household = await seedHousehold(db.em());
    const lone = await connect(db, household, { bank: 'Alpha Bank' });
    const pairA = await connect(db, household, { bank: 'Zulu Bank' });
    const pairB = await connect(db, household, { bank: 'Zulu Bank' });
    for (const connection of [lone, pairA, pairB]) await run(db, household, connection, [failed(60)]);

    const { connections } = await listFailingBankConnections(db.em(), { now: NOW });

    expect(connections.map((connection) => connection.institution.name)).toEqual(['Zulu Bank', 'Zulu Bank', 'Alpha Bank']);
  });
});

describe('what the sync health responses reveal', () => {
  const db = useTestDatabase();

  /** Every key at any depth, and every string value. */
  function keysAndStrings(value: unknown, keys = new Set<string>(), strings: string[] = []): { keys: Set<string>; strings: string[] } {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) for (const item of value) keysAndStrings(item, keys, strings);
    else if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        keys.add(key);
        keysAndStrings(nested, keys, strings);
      }
    }
    return { keys, strings };
  }

  it('carries no user, household, account or connection identifiers, names, IBANs or descriptions', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    household.account.accountName = 'Holiday savings jar';
    household.account.accountNumber = 'PT50000201231234567890154';
    household.account.holderName = 'Maria Example';
    await em.flush();
    const connection = await connect(db, household, { bank: 'Example Bank' });
    await run(db, household, connection, [ok(90), failed(60, 'consent_expired')]);
    await run(db, household, connection, [failed(3, 'consent_expired')]);

    const health = await getBankSyncHealth(db.em(), { now: NOW });
    const failing = await listFailingBankConnections(db.em(), { now: NOW });
    expect(failing.connections).toHaveLength(1);

    const { keys, strings } = keysAndStrings({ failing, health });
    const forbiddenKey = /user|tenant|household|account(?!s?$)|email|iban|description|requisition|session|state$|connectionKey|^id$|key$/i;
    const allowedKeys = new Set(['id']);
    // `id` is the institution's id only; any other key that names a person or a row is a leak.
    expect([...keys].filter((key) => forbiddenKey.test(key) && !(allowedKeys.has(key)))).toEqual([]);

    const secrets = [
      household.appuser.emailAddress,
      household.appuser.externalUserId,
      household.appuser.firstName ?? '',
      'Holiday savings jar',
      'PT50000201231234567890154',
      'Maria Example',
      connection.requisitionId,
    ].filter(Boolean);
    for (const secret of secrets) {
      expect(strings.some((value) => value.includes(secret))).toBe(false);
    }
    // The institution's id is the only `id`, and it is the bank's, not a row's.
    expect(failing.connections[0]?.institution.id).toBe('enable_banking:pt:example-bank');
  });
});
