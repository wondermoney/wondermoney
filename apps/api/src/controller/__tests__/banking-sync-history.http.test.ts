import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { type TestDatabase, useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { deterministicRequisitionContext } from '@app/analytics/bank-sync-contract';
import type { Appuser } from '@entity/Appuser';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { BankSyncFinality, BankSyncFlow, BankSyncIncident, BankSyncResult, BankSyncRolloutMode } from '@entity/BankSyncIncident';
import { BankSyncAttemptResult, BankSyncIncidentAttempt } from '@entity/BankSyncIncidentAttempt';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import bankingRoutes from '@route/banking';

/*
 * A connection is per-user, not household-wide. The history endpoint must show the caller's
 * own runs and nothing else: a partner's connection, or one from another household, is a 404.
 */
interface AttemptInput {
  accountCount?: number;
  completedAt?: Date;
  correlationId?: string;
  errorCode?: string;
  finality?: BankSyncFinality;
  flow?: BankSyncFlow;
  result?: BankSyncAttemptResult;
  retryAfterSeconds?: number;
  rowsCreated?: number;
  startedAt: Date;
  userVisible?: boolean;
}

async function addAttempt(db: TestDatabase, connection: EnableBankingConnection, owner: Appuser, input: AttemptInput) {
  const em = db.em();
  const requisitionId = connection.sessionId ?? connection.state;
  const correlationId = input.correlationId ?? `account.auto-sync.requisition:${randomUUID()}:${connection.enableBankingConnectionKey}`;
  const incident = em.create(BankSyncIncident, {
    appuserKey: owner,
    attempts: 1,
    correlationId,
    errorCategory: input.errorCode ? 'provider' : undefined,
    errorCode: input.errorCode ?? undefined,
    finality: input.finality ?? (input.result === BankSyncAttemptResult.FULL_SUCCESS ? BankSyncFinality.TERMINAL_SUCCESS : BankSyncFinality.TERMINAL_FAILURE),
    flow: input.flow ?? BankSyncFlow.SCHEDULED_REFRESH,
    incidentId: randomUUID(),
    requisitionId,
    result: input.result === BankSyncAttemptResult.FULL_SUCCESS ? BankSyncResult.SUCCESS : input.result === BankSyncAttemptResult.PARTIAL ? BankSyncResult.PARTIAL : BankSyncResult.FAILURE,
    retryAfterSeconds: input.retryAfterSeconds,
    rolloutMode: BankSyncRolloutMode.OFF,
    userVisible: input.userVisible ?? false,
  }, { partial: true });
  em.create(BankSyncIncidentAttempt, {
    accountCount: input.accountCount,
    attempt: 1,
    completedAt: input.completedAt ?? input.startedAt,
    errorCategory: input.errorCode ? 'provider' : undefined,
    errorCode: input.errorCode ?? undefined,
    incidentKey: incident,
    queueAttempt: 1,
    queueJobId: `job-${randomUUID()}`,
    requisitionContext: deterministicRequisitionContext(requisitionId),
    result: input.result ?? BankSyncAttemptResult.FAILED,
    startedAt: input.startedAt,
  }, { partial: true });
  if (input.rowsCreated !== undefined) {
    em.create(BackgroundOperation, {
      attemptCount: 1,
      correlationId,
      operationType: 'account.auto-sync.requisition',
      progress: { transactionsCreated: input.rowsCreated },
      queueProvider: 'pg-boss',
      resourceId: `enable-banking-connection:${connection.enableBankingConnectionKey}`,
      retryable: false,
      status: BackgroundOperationStatus.SUCCEEDED,
    }, { partial: true });
  }
  await em.flush();
  return incident;
}

async function linkBank(db: TestDatabase, household: Household, member: Appuser, overrides: { sessionId?: string; state?: string } = {}) {
  const em = db.em();
  const credential = em.create(EnableBankingCredential, {
    applicationId: `app-${member.appuserKey}`, appuserKey: member, encryptionKeyVersion: 1,
    privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: household.tenant,
  }, { partial: true });
  const connection = em.create(EnableBankingConnection, {
    accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: member, aspspCountry: 'PT', aspspName: 'Bank',
    enableBankingCredentialKey: credential, sessionId: overrides.sessionId ?? `session-${member.appuserKey}`,
    state: overrides.state ?? `state-${member.appuserKey}`, status: EnableBankingConnectionStatus.LINKED, tenantKey: household.tenant,
  }, { partial: true });
  await em.flush();
  return connection;
}

describe('GET /v1/banking/connections/:connectionId/syncs', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });
  useRequestContextEm(db);
  const http = tenantHttp('/v1/banking', bankingRoutes);

  it('returns the caller\'s runs newest first, with flow, result, error, accounts and rows created', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkBank(db, household, household.appuser);
    await addAttempt(db, connection, household.appuser, {
      accountCount: 3, completedAt: new Date('2026-07-20T10:05:00.000Z'), errorCode: 'provider_unavailable',
      rowsCreated: 12, startedAt: new Date('2026-07-20T10:00:00.000Z'),
    });
    await addAttempt(db, connection, household.appuser, {
      accountCount: 3, completedAt: new Date('2026-07-21T10:05:00.000Z'), flow: BankSyncFlow.INITIAL_ADD,
      result: BankSyncAttemptResult.FULL_SUCCESS, rowsCreated: 4, startedAt: new Date('2026-07-21T10:00:00.000Z'),
    });

    const response = await http.as(household.appuser).get(`/v1/banking/connections/${connection.enableBankingConnectionKey}/syncs`);

    expect(response.status).toBe(200);
    expect(response.body.syncs).toHaveLength(2);
    expect(response.body.syncs[0]).toEqual({
      accounts: 3,
      errorCode: null,
      finishedAt: '2026-07-21T10:05:00.000Z',
      flow: 'initial-add',
      result: 'full_success',
      retryAt: null,
      rowsCreated: 4,
      startedAt: '2026-07-21T10:00:00.000Z',
    });
    expect(response.body.syncs[1]).toMatchObject({
      accounts: 3,
      errorCode: 'provider_unavailable',
      finishedAt: '2026-07-20T10:05:00.000Z',
      flow: 'scheduled-refresh',
      result: 'failed',
      rowsCreated: 12,
      startedAt: '2026-07-20T10:00:00.000Z',
    });
    expect(response.body.syncs[1]).not.toHaveProperty('incidentId');
    expect(response.body.syncs[1]).not.toHaveProperty('correlationId');
  });

  it('gives a rate-limited run the next attempt time', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkBank(db, household, household.appuser);
    await addAttempt(db, connection, household.appuser, {
      completedAt: new Date('2026-07-21T10:05:00.000Z'), errorCode: 'rate_limited', retryAfterSeconds: 3600,
      startedAt: new Date('2026-07-21T10:00:00.000Z'),
    });

    const response = await http.as(household.appuser).get(`/v1/banking/connections/${connection.enableBankingConnectionKey}/syncs`);

    expect(response.status).toBe(200);
    expect(response.body.syncs[0]).toMatchObject({ errorCode: 'rate_limited', retryAt: '2026-07-21T11:05:00.000Z' });
  });

  it('returns at most the last 20 runs', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkBank(db, household, household.appuser);
    for (let index = 0; index < 21; index += 1) {
      await addAttempt(db, connection, household.appuser, {
        completedAt: new Date(Date.UTC(2026, 6, 1, 10, index, 5)),
        result: BankSyncAttemptResult.FULL_SUCCESS,
        startedAt: new Date(Date.UTC(2026, 6, 1, 10, index, 0)),
      });
    }

    const response = await http.as(household.appuser).get(`/v1/banking/connections/${connection.enableBankingConnectionKey}/syncs`);

    expect(response.status).toBe(200);
    expect(response.body.syncs).toHaveLength(20);
    expect(response.body.syncs[0].startedAt).toBe(new Date(Date.UTC(2026, 6, 1, 10, 20, 0)).toISOString());
  });

  it('404s a connection from another household', async () => {
    const household = await seedHousehold(db.em());
    const other = await seedHousehold(db.em());
    const connection = await linkBank(db, other, other.appuser);

    const response = await http.as(household.appuser).get(`/v1/banking/connections/${connection.enableBankingConnectionKey}/syncs`);

    expect(response.status).toBe(404);
  });

  it("404s the caller's partner's connection", async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const connection = await linkBank(db, household, partner);

    const response = await http.as(household.appuser).get(`/v1/banking/connections/${connection.enableBankingConnectionKey}/syncs`);

    expect(response.status).toBe(404);
  });

  it('exposes connectionId and the newest failure on the connection list', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkBank(db, household, household.appuser);
    await addAttempt(db, connection, household.appuser, {
      completedAt: new Date('2026-07-21T10:05:00.000Z'), errorCode: 'consent_expired',
      startedAt: new Date('2026-07-21T10:00:00.000Z'),
    });

    const response = await http.as(household.appuser).get('/v1/banking/connections');

    expect(response.status).toBe(200);
    expect(response.body.connections).toHaveLength(1);
    expect(response.body.connections[0]).toMatchObject({
      connectionId: connection.enableBankingConnectionKey,
      lastError: { code: 'consent_expired', occurredAt: expect.any(String) },
      provider: 'EnableBanking',
    });
  });
});
