import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { handleMcpOAuthClientPruneJob } from '@app/jobs/mcp-oauth-client-prune.worker';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

// better-auth's OAuth tables have no entities, so the schema comes from the migrations. The real
// server when TEST_POSTGRES_URL is set (concurrent sessions on a pool), else PGlite.
const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-26T04:40:00Z');
const RESOURCE = 'https://api.example.test/v1/mcp';
const job = { data: {}, id: 'job-1' } as unknown as Job<Record<string, never>>;

const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const later = (days: number) => new Date(NOW.getTime() + days * DAY);
const sql = (query: string, params: unknown[] = []) => db.em().getConnection().execute(query, params);
const OAUTH_TABLES = ['oauthAccessToken', 'oauthRefreshToken', 'oauthConsent', 'oauthClientResource', 'oauthClient', 'oauthResource'];

async function addPerson(): Promise<string> {
  const id = randomUUID();
  await sql('insert into better_auth."user" (id, name, email, "emailVerified") values (?, ?, ?, true)', [id, 'Person', `${id}@example.test`]);
  return id;
}

/** A registered client with its resource link, as dynamic registration leaves it. */
async function addClient(registeredAt: Date): Promise<string> {
  const clientId = randomUUID();
  await sql(
    `insert into better_auth."oauthClient" (id, "clientId", name, "redirectUris", "createdAt", "updatedAt")
     values (?, ?, 'Some client', '["https://client.example.test/callback"]'::jsonb, ?, ?)`,
    [randomUUID(), clientId, registeredAt, registeredAt],
  );
  await sql('insert into better_auth."oauthClientResource" (id, "clientId", "resourceId", "createdAt") values (?, ?, ?, ?)', [randomUUID(), clientId, RESOURCE, registeredAt]);
  return clientId;
}

const CONSENT = `insert into better_auth."oauthConsent" (id, "clientId", "userId", "referenceId", scopes, "createdAt", "updatedAt")
  values (?, ?, ?, 'household-ref', '["mcp:read","offline_access"]'::jsonb, ?, ?)`;

async function addConsent(clientId: string, userId: string, at: Date): Promise<void> {
  await sql(CONSENT, [randomUUID(), clientId, userId, at, at]);
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the prune to block');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A refresh token and the access token issued beside it. */
async function addTokens(clientId: string, userId: string, refresh: { expiresAt: Date; issuedAt: Date; revoked?: Date }): Promise<void> {
  const refreshId = randomUUID();
  await sql(
    `insert into better_auth."oauthRefreshToken" (id, token, "clientId", "userId", "expiresAt", "createdAt", revoked, scopes)
     values (?, ?, ?, ?, ?, ?, ?, '["mcp:read","offline_access"]'::jsonb)`,
    [refreshId, randomUUID(), clientId, userId, refresh.expiresAt, refresh.issuedAt, refresh.revoked ?? null],
  );
  await sql(
    `insert into better_auth."oauthAccessToken" (id, token, "clientId", "userId", "refreshId", "expiresAt", "createdAt", scopes)
     values (?, ?, ?, ?, ?, ?, ?, '["mcp:read"]'::jsonb)`,
    [randomUUID(), randomUUID(), clientId, userId, refreshId, new Date(refresh.issuedAt.getTime() + 15 * 60 * 1000), refresh.issuedAt],
  );
}

/** How many rows each OAuth table holds for `clientId`. */
async function rowsOf(clientId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ['oauthClient', 'oauthClientResource', 'oauthConsent', 'oauthRefreshToken', 'oauthAccessToken']) {
    const [row] = await sql(`select count(*)::int as count from better_auth."${table}" where "clientId" = ?`, [clientId]);
    counts[table] = (row as { count: number }).count;
  }
  return counts;
}

const NONE = { oauthAccessToken: 0, oauthClient: 0, oauthClientResource: 0, oauthConsent: 0, oauthRefreshToken: 0 };

const prune = (enabled = true) =>
  handleMcpOAuthClientPruneJob(job, { em: db.em(), isEnabled: () => enabled, logger: { info: vi.fn(), warn: vi.fn() }, now: () => NOW });

describe('the MCP OAuth client prune job', () => {
  beforeEach(async () => {
    for (const table of OAUTH_TABLES) await sql(`delete from better_auth."${table}"`);
    await sql('delete from better_auth."user"');
    await sql(`insert into better_auth."oauthResource" (id, identifier, name) values (?, ?, 'MCP')`, [randomUUID(), RESOURCE]);
  });

  it('removes a client registered over seven days ago that never got a consent, with its rows', async () => {
    const unused = await addClient(ago(8));

    expect(await prune()).toMatchObject({ pruned: 1 });

    expect(await rowsOf(unused)).toEqual(NONE);
    const [resource] = await sql('select count(*)::int as count from better_auth."oauthResource"');
    expect(resource).toEqual({ count: 1 });
  });

  it('removes an old client whose every grant was revoked, with its revoked and expired tokens', async () => {
    const person = await addPerson();
    const revoked = await addClient(ago(30));
    await addTokens(revoked, person, { expiresAt: later(20), issuedAt: ago(20), revoked: ago(2) });
    await addTokens(revoked, person, { expiresAt: ago(1), issuedAt: ago(29) });

    expect(await prune()).toMatchObject({ pruned: 1 });

    expect(await rowsOf(revoked)).toEqual(NONE);
    const [user] = await sql('select count(*)::int as count from better_auth."user" where id = ?', [person]);
    expect(user).toEqual({ count: 1 });
  });

  it('keeps a client registered less than seven days ago', async () => {
    const recent = await addClient(ago(6));

    expect(await prune()).toMatchObject({ pruned: 0 });

    expect(await rowsOf(recent)).toMatchObject({ oauthClient: 1, oauthClientResource: 1 });
  });

  it('keeps an old client with a consent or a live refresh token, and every row of it', async () => {
    const person = await addPerson();
    const consented = await addClient(ago(40));
    await addConsent(consented, person, ago(39));
    await addTokens(consented, person, { expiresAt: later(10), issuedAt: ago(1) });
    // Consent deleted, refresh token still standing: the grant is not gone yet.
    const refreshing = await addClient(ago(40));
    await addTokens(refreshing, person, { expiresAt: later(10), issuedAt: ago(1) });
    const unused = await addClient(ago(40));

    expect(await prune()).toMatchObject({ pruned: 1 });

    expect(await rowsOf(consented)).toEqual({ oauthAccessToken: 1, oauthClient: 1, oauthClientResource: 1, oauthConsent: 1, oauthRefreshToken: 1 });
    expect(await rowsOf(refreshing)).toEqual({ oauthAccessToken: 1, oauthClient: 1, oauthClientResource: 1, oauthConsent: 0, oauthRefreshToken: 1 });
    expect(await rowsOf(unused)).toEqual(NONE);
  });

  it('keeps an old client with a consent even when its refresh tokens are all revoked', async () => {
    const person = await addPerson();
    const consented = await addClient(ago(40));
    await addConsent(consented, person, ago(39));
    await addTokens(consented, person, { expiresAt: later(10), issuedAt: ago(5), revoked: ago(4) });

    expect(await prune()).toMatchObject({ pruned: 0 });

    expect(await rowsOf(consented)).toMatchObject({ oauthClient: 1, oauthConsent: 1, oauthRefreshToken: 1 });
  });

  it.runIf(process.env['TEST_POSTGRES_URL'])('keeps a client that gets a consent while the job is removing it', async () => {
    const person = await addPerson();
    const client = await addClient(ago(10));

    // A consent being stored, not yet committed: the job's scan cannot see it, and its row lock on
    // the client waits for the consent's foreign key lock.
    const consent = db.em();
    await consent.begin();
    await consent.getConnection().execute(CONSENT, [randomUUID(), client, person, NOW, NOW], 'run', consent.getTransactionContext());
    const running = prune();
    await waitFor(async () => {
      const [row] = await sql(`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
      return (row as { waiting: number }).waiting === 1;
    });
    await consent.commit();

    expect(await running).toMatchObject({ kept: 1, pruned: 0 });
    expect(await rowsOf(client)).toMatchObject({ oauthClient: 1, oauthClientResource: 1, oauthConsent: 1 });
  });

  it('does nothing while OAuth for the MCP server is off', async () => {
    const unused = await addClient(ago(30));

    expect(await prune(false)).toEqual({ pruned: 0, skipped: true });

    expect(await rowsOf(unused)).toMatchObject({ oauthClient: 1, oauthClientResource: 1 });
  });

  it('logs counts only, never a client name or redirect', async () => {
    await addClient(ago(8));
    const info = vi.fn();

    await handleMcpOAuthClientPruneJob(job, { em: db.em(), isEnabled: () => true, logger: { info, warn: vi.fn() }, now: () => NOW });

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"pruned":1');
    expect(logged).not.toMatch(/Some client|client\.example\.test/);
  });
});
