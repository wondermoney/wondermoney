import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 9).toString('base64');
});
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
// DNS stand-in: the SimpleFIN hosts resolve to a public address, and nothing is looked up for real.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: [34, 120, 0, 10].join('.'), family: 4 }]) }));

import { addAccount, addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { BankSyncIncident } from '@entity/BankSyncIncident';
import { SimplefinConnection } from '@entity/SimplefinConnection';
import bankingRoutes from '@route/banking';
import { ACCESS_PASSWORD, ACCESS_URL, CLAIM_ID, fakeSimplefinServer, SETUP_TOKEN } from '@service/simplefin/__tests__/fixtures';
import { decryptAccessUrl } from '@service/simplefin/simplefin-credential';
import logger from '@utils/logger';

/*
 * Connecting with a SimpleFIN setup token over HTTP, through the real authenticated-tenant stack
 * and database. The SimpleFIN server is an in-memory fake; no request leaves the process.
 *
 * The token and the access URL it is exchanged for are credentials: they must be stored only
 * encrypted and never appear in a response, a log line or an error.
 */
const SECRETS = [SETUP_TOKEN, ACCESS_URL, ACCESS_PASSWORD, CLAIM_ID];

describe('SimpleFIN connections over HTTP', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });
  useRequestContextEm(db);
  const send = vi.fn(async () => 'job-1');
  const http = tenantHttp('/v1/banking', bankingRoutes, { enqueue: { send, sendAfter: vi.fn(async () => 'job-later') } });
  let logged: unknown[][];

  beforeEach(() => {
    vi.stubEnv('BANK_PROVIDERS', 'enable_banking,simplefin');
    logged = [];
    for (const level of ['debug', 'error', 'fatal', 'info', 'trace', 'warn'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logged.push(args); }));
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const leaked = (...values: unknown[]) => {
    const text = JSON.stringify([values, logged], (_key, value: unknown) => (value instanceof Error ? { message: value.message, name: value.name, stack: value.stack } : value));
    return SECRETS.filter((secret) => text.includes(secret));
  };

  function serve(options: Parameters<typeof fakeSimplefinServer>[0] = {}) {
    const server = fakeSimplefinServer(options);
    vi.stubGlobal('fetch', server.fetch);
    return server;
  }

  it('claims the token once, stores the access URL encrypted, and returns neither', async () => {
    const household = await seedHousehold(db.em());
    const server = serve();

    const response = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken: SETUP_TOKEN });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ connectionId: expect.any(Number), incidentId: expect.any(String) });
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(1);

    const stored = await db.em().findOneOrFail(SimplefinConnection, { simplefinConnectionKey: response.body.connectionId }, { filters: false, populate: ['bankConnectionKey'] });
    expect(stored.serverHost).toBe('beta-bridge.simplefin.org');
    expect(JSON.stringify(stored)).not.toContain(ACCESS_PASSWORD);
    expect(stored.accessUrlCiphertext).toBeTruthy();
    expect(decryptAccessUrl(stored)).toBe(ACCESS_URL);
    expect(stored.bankConnectionKey).toMatchObject({ provider: 'simplefin', status: BankConnectionStatus.LINKED });
    expect(stored.bankConnectionKey.accessValidUntil ?? null).toBeNull();
    expect(stored.bankConnectionKey.tenantKey?.tenantKey).toBe(household.tenant.tenantKey);

    // The first sync was queued for this connection.
    const incident = await db.em().findOneOrFail(BankSyncIncident, { incidentId: response.body.incidentId });
    expect(incident.requisitionId).toBe(stored.bankConnectionKey.externalId);
    expect(send).toHaveBeenCalledTimes(1);

    const list = await http.as(household.appuser).get('/v1/banking/connections');
    expect(list.status).toBe(200);
    expect(list.body.connections).toEqual([expect.objectContaining({ bankId: null, connectionId: response.body.connectionId, expiresAt: null, provider: 'SimpleFIN', status: 'processing' })]);
    expect(leaked(response.body, list.body, send.mock.calls)).toEqual([]);
  });

  it('answers 501 and claims nothing while BANK_PROVIDERS leaves SimpleFIN out', async () => {
    vi.stubEnv('BANK_PROVIDERS', 'enable_banking');
    const household = await seedHousehold(db.em());
    const server = serve();

    const response = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken: SETUP_TOKEN });

    expect(response.status).toBe(501);
    expect(response.body.code).toBe('feature_disabled');
    expect(server.calls).toEqual([]);
  });

  it('refuses a bad token and an SSRF attempt without calling out or echoing the token', async () => {
    const household = await seedHousehold(db.em());
    const server = serve();
    const internal = Buffer.from(`https://169.254.169.254/latest/meta-data/${CLAIM_ID}`).toString('base64');

    for (const [setupToken, code] of [
      ['definitely not a token', 'simplefin_token_invalid'],
      [internal, 'simplefin_server_not_allowed'],
      [Buffer.from(`http://beta-bridge.simplefin.org/claim/${CLAIM_ID}`).toString('base64'), 'simplefin_token_invalid'],
    ] as const) {
      const response = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(code);
      expect(JSON.stringify(response.body)).not.toContain(setupToken);
      expect(leaked(response.body)).toEqual([]);
    }
    expect(server.calls).toEqual([]);
    expect(await db.em().count(SimplefinConnection, {}, { filters: false })).toBe(0);
  });

  it('explains an already-claimed token without storing anything or repeating it', async () => {
    const household = await seedHousehold(db.em());
    serve({ claimStatus: 403 });

    const response = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken: SETUP_TOKEN });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('simplefin_token_already_claimed');
    expect(leaked(response.body)).toEqual([]);
    expect(await db.em().count(BankConnection, { provider: 'simplefin' })).toBe(0);
  });

  it('refuses an access URL the claim points somewhere it should not', async () => {
    const household = await seedHousehold(db.em());
    serve({ claimBody: `https://user:${ACCESS_PASSWORD}@attacker.example.test/simplefin` });

    const response = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken: SETUP_TOKEN });

    expect(response.status).toBe(400);
    expect(leaked(response.body)).toEqual([]);
    expect(await db.em().count(SimplefinConnection, {}, { filters: false })).toBe(0);
  });

  it('shows a connection, its history and its disconnect only to the member who made it', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const other = await seedHousehold(db.em());
    serve();
    const created = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken: SETUP_TOKEN });
    const { connectionId } = created.body as { connectionId: number };

    expect((await http.as(household.appuser).get(`/v1/banking/simplefin/connections/${connectionId}/syncs`)).status).toBe(200);
    for (const stranger of [partner, other.appuser]) {
      expect((await http.as(stranger).get('/v1/banking/connections')).body.connections).toEqual([]);
      expect((await http.as(stranger).get(`/v1/banking/simplefin/connections/${connectionId}/syncs`)).status).toBe(404);
      expect((await http.as(stranger).delete(`/v1/banking/simplefin/connections/${connectionId}`)).status).toBe(404);
    }
    // The Enable Banking routes are a different id space and never answer for it.
    expect((await http.as(household.appuser).get(`/v1/banking/connections/${connectionId}/syncs`)).status).toBe(404);
    const stored = await db.em().findOneOrFail(SimplefinConnection, { simplefinConnectionKey: connectionId }, { filters: false });
    expect(stored.deletedAt ?? null).toBeNull();
  });

  it('disconnects by destroying the stored access and stopping the connection, idempotently', async () => {
    const household = await seedHousehold(db.em());
    serve();
    const created = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken: SETUP_TOKEN });
    const { connectionId } = created.body as { connectionId: number };

    expect((await http.as(household.appuser).delete(`/v1/banking/simplefin/connections/${connectionId}`)).status).toBe(200);
    expect((await http.as(household.appuser).delete(`/v1/banking/simplefin/connections/${connectionId}`)).status).toBe(200);

    const stored = await db.em().findOneOrFail(SimplefinConnection, { simplefinConnectionKey: connectionId }, { filters: false, populate: ['bankConnectionKey'] });
    expect(stored.deletedAt).toBeInstanceOf(Date);
    expect([stored.accessUrlCiphertext, stored.accessUrlIv, stored.accessUrlAuthTag, stored.encryptionKeyVersion]).toEqual([null, null, null, null]);
    expect(stored.bankConnectionKey.deletedAt).toBeInstanceOf(Date);
    expect((await http.as(household.appuser).get('/v1/banking/connections')).body.connections).toEqual([]);
  });

  it('reports a revoked connection as revoked, with its accounts\' freshness', async () => {
    const household = await seedHousehold(db.em());
    serve();
    const created = await http.as(household.appuser).post('/v1/banking/simplefin/connections').send({ setupToken: SETUP_TOKEN });
    const stored = await db.em().findOneOrFail(SimplefinConnection, { simplefinConnectionKey: created.body.connectionId }, { filters: false, populate: ['bankConnectionKey'] });
    const account = await addAccount(db.em(), household);
    const em = db.em();
    await em.nativeUpdate(BankConnection, { bankConnectionKey: stored.bankConnectionKey.bankConnectionKey }, { status: BankConnectionStatus.REVOKED });
    await em.nativeUpdate(SimplefinConnection, { simplefinConnectionKey: stored.simplefinConnectionKey }, { institutionName: 'Example Bank' });
    await em.nativeUpdate(Account, { accountKey: account.accountKey }, { bankConnectionKey: stored.bankConnectionKey, refreshedAt: new Date('2026-11-01T00:00:00Z') });

    const list = await http.as(household.appuser).get('/v1/banking/connections');

    expect(list.body.connections).toEqual([expect.objectContaining({ dataFreshAsOf: '2026-11-01T00:00:00.000Z', institutionName: 'Example Bank', provider: 'SimpleFIN', status: 'revoked' })]);
  });
});
