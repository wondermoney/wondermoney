import { createHash, randomBytes } from 'node:crypto';

import { createOTP } from '@better-auth/utils/otp';
import { RequestContext } from '@mikro-orm/postgresql';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The real better-auth with its OAuth provider for MCP, against a real database built from the
// migrations (its `better_auth` schema has no entities). The switch is read when the module is
// first imported, so it and everything that imports it are imported only once the test database
// exists and `MCP_OAUTH_ENABLED` is set.
vi.unmock('@service/auth/better-auth');
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { symmetricEncrypt } from 'better-auth/crypto';

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { pruneUnusedMcpOAuthClients } from '@service/mcp/mcp-oauth-client-prune.service';
import { FRONTEND_URL } from '@utils/constants';

const PASSWORD = 'correct horse battery staple';
const REDIRECT_URI = 'https://chatgpt.example.test/connector/oauth/callback-1';

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** A PKCE pair (RFC 7636, S256). */
function pkce() {
  const verifier = base64url(randomBytes(32));
  return { challenge: base64url(createHash('sha256').update(verifier).digest()), verifier };
}

const pathOf = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

/*
 * An MCP client that knows only the server's URL, through better-auth's own authorization server:
 * discovery from the 401, dynamic registration, sign-in, consent, the code exchange with PKCE,
 * tool calls, refresh, and revocation in Settings. Needs a real server (`TEST_POSTGRES_URL`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('OAuth for the MCP server, end to end', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
  let closePool: () => Promise<void>;
  let app: express.Express;
  const loginOf = new Map<number, { email: string; userId: string }>();

  beforeAll(async () => {
    const server = new URL(process.env['TEST_POSTGRES_URL'] ?? '');
    Object.assign(process.env, {
      BETTER_AUTH_SECRET: 'mcp-oauth-test-secret-0123456789abcdefghij',
      DB_DATABASE: String(db.orm.config.get('dbName')),
      DB_HOST: server.hostname,
      DB_PASSWORD: decodeURIComponent(server.password),
      DB_PORT: server.port || '5432',
      DB_USERNAME: decodeURIComponent(server.username),
      MCP_OAUTH_ENABLED: 'true',
    });
    const auth = await import('@service/auth/better-auth');
    const { authedTenant } = await import('@middleware/stacks');
    const { errorHandler } = await import('@middleware/error-handler');
    const mcpRoutes = (await import('@route/mcp')).default;
    const metadataRoutes = (await import('@route/mcp-oauth-metadata')).default;
    const userRoutes = (await import('@route/user')).default;
    closePool = auth.closeBetterAuthPool;
    app = express();
    app.all('/api/auth/*splat', auth.authHandler);
    app.use((_req, _res, next) => {
      RequestContext.create(db.orm.em, next);
    });
    app.use(express.json());
    app.use('/.well-known', metadataRoutes);
    app.use('/v1/mcp', mcpRoutes);
    app.use('/v1/user', ...authedTenant(), userRoutes);
    app.use(errorHandler);
  }, 60_000);

  afterAll(async () => {
    delete process.env['MCP_OAUTH_ENABLED'];
    await closePool();
  });

  beforeEach(() => {
    DI.em = db.em();
    // App rows and their keys start over for every test; the logins in `better_auth` do not.
    loginOf.clear();
  });

  let people = 0;
  /** A better-auth login bound to `appuser`, signed in: its session cookie. */
  async function signInAs(appuser: Appuser): Promise<string> {
    const existing = loginOf.get(appuser.appuserKey);
    if (existing) {
      const again = await request(app).post('/api/auth/sign-in/email').set('Origin', FRONTEND_URL).send({ email: existing.email, password: PASSWORD }).expect(200);
      return (again.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
    }
    people += 1;
    const email = `person${people}@example.test`;
    const signUp = await request(app).post('/api/auth/sign-up/email').set('Origin', FRONTEND_URL).send({ email, name: email, password: PASSWORD }).expect(200);
    const userId = (signUp.body as { user: { id: string } }).user.id;
    await db.em().nativeUpdate(Appuser, { appuserKey: appuser.appuserKey }, { emailAddress: email, externalUserId: userId });
    loginOf.set(appuser.appuserKey, { email, userId });
    const signIn = await request(app).post('/api/auth/sign-in/email').set('Origin', FRONTEND_URL).send({ email, password: PASSWORD }).expect(200);
    return (signIn.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
  }

  interface Discovery {
    authorization_endpoint: string;
    code_challenge_methods_supported: string[];
    grant_types_supported: string[];
    registration_endpoint: string;
    resource: string;
    revocation_endpoint?: string;
    token_endpoint: string;
  }

  /** What a client learns from the server's URL alone. */
  async function discover(): Promise<Discovery> {
    const unauthenticated = await request(app).post('/v1/mcp').set('Accept', 'application/json, text/event-stream').send({ id: 1, jsonrpc: '2.0', method: 'initialize' });
    expect(unauthenticated.status).toBe(401);
    const resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(String(unauthenticated.headers['www-authenticate']))?.[1] ?? '';
    const resourceMetadata = (await request(app).get(pathOf(resourceMetadataUrl)).expect(200)).body as { authorization_servers: string[]; resource: string };
    const issuer = new URL(resourceMetadata.authorization_servers[0] ?? '');
    // RFC 8414: the well-known suffix goes between the host and the issuer's path.
    const serverMetadata = (await request(app).get(`/.well-known/oauth-authorization-server${issuer.pathname}`).expect(200)).body as Omit<Discovery, 'resource'> & { issuer: string };
    expect(serverMetadata.issuer).toBe(issuer.toString().replace(/\/$/, ''));
    return { ...serverMetadata, resource: resourceMetadata.resource };
  }

  const registration = (discovery: Discovery, redirectUris: string[], name = 'ChatGPT') => request(app).post(pathOf(discovery.registration_endpoint)).send({
    client_name: name,
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: redirectUris,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });

  async function register(discovery: Discovery, name = 'ChatGPT'): Promise<string> {
    const response = await registration(discovery, [REDIRECT_URI], name);
    expect(response.status).toBe(201);
    return (response.body as { client_id: string }).client_id;
  }

  function authorizeUrl(discovery: Discovery, clientId: string, input: { challenge?: string; omitResource?: boolean; scope?: string; state?: string }) {
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: input.scope ?? 'mcp:read offline_access', state: input.state ?? 'state-1' });
    if (!input.omitResource) params.set('resource', discovery.resource);
    if (input.challenge) {
      params.set('code_challenge', input.challenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${pathOf(discovery.authorization_endpoint)}?${params.toString()}`;
  }

  /** The person signs in, sees the consent page and accepts: the code the client receives. */
  /** The signed query the authorization endpoint hands the consent page. */
  async function consentQuery(discovery: Discovery, clientId: string, cookie: string, input: { challenge?: string; omitResource?: boolean; scope?: string }): Promise<string> {
    const authorize = await request(app).get(authorizeUrl(discovery, clientId, input)).set('Cookie', cookie);
    expect(authorize.status).toBe(302);
    const consentPage = new URL(String(authorize.headers['location']));
    expect(`${consentPage.origin}${consentPage.pathname}`).toBe(new URL('oauth/consent', `${FRONTEND_URL}/`).toString());
    return consentPage.search.slice(1);
  }

  const postConsent = (cookie: string, body: object, totp?: string) => {
    const agent = request(app).post('/api/auth/oauth2/consent').set('Origin', FRONTEND_URL).set('Cookie', cookie);
    return (totp ? agent.set('x-totp-code', totp) : agent).send(body);
  };

  async function consent(discovery: Discovery, clientId: string, cookie: string, input: { acceptScope?: string; challenge: string; omitResource?: boolean; scope?: string; totp?: string }): Promise<string> {
    const oauthQuery = await consentQuery(discovery, clientId, cookie, input);
    const accepted = await postConsent(cookie, { accept: true, oauth_query: oauthQuery, ...(input.acceptScope ? { scope: input.acceptScope } : {}) }, input.totp).expect(200);
    const callback = new URL((accepted.body as { url: string }).url);
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('state-1');
    return callback.searchParams.get('code') ?? '';
  }

  async function exchange(discovery: Discovery, clientId: string, code: string, verifier: string, overrides: { omitResource?: boolean; redirectUri?: string } = {}) {
    return request(app).post(pathOf(discovery.token_endpoint)).type('form').send({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: overrides.redirectUri ?? REDIRECT_URI,
      ...(overrides.omitResource ? {} : { resource: discovery.resource }),
    });
  }

  async function refresh(discovery: Discovery, clientId: string, refreshToken: string) {
    return request(app).post(pathOf(discovery.token_endpoint)).type('form').send({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, resource: discovery.resource });
  }

  const mcp = (accessToken: string, body: object) =>
    request(app).post('/v1/mcp').set('Accept', 'application/json, text/event-stream').set('Authorization', `Bearer ${accessToken}`).send(body);
  const listAccounts = (accessToken: string) => mcp(accessToken, { id: 2, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'list_accounts' } });
  const accountNames = (response: request.Response) =>
    (response.body.result.structuredContent as { accounts: { name: string }[] }).accounts.map((account) => account.name);

  /** A household whose owner has a shared account and whose partner has a private one. */
  async function householdWithPartner(): Promise<{ household: Household; partner: Appuser }> {
    const em = db.em();
    const household = await seedHousehold(em);
    const partner = await addPartner(em, household);
    await addAccount(em, household, { name: 'Joint account' });
    await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });
    return { household, partner };
  }

  /** A person connected through the whole flow: their tokens and the client's id. */
  async function connect(appuser: Appuser, scope?: { acceptScope?: string }) {
    const cookie = await signInAs(appuser);
    const discovery = await discover();
    const clientId = await register(discovery);
    const { challenge, verifier } = pkce();
    const code = await consent(discovery, clientId, cookie, { challenge, ...scope });
    const tokens = await exchange(discovery, clientId, code, verifier);
    expect(tokens.status).toBe(200);
    return { clientId, cookie, discovery, tokens: tokens.body as { access_token: string; expires_in: number; refresh_token?: string; scope: string } };
  }

  it('registers, signs the person in, gets consent and calls the read tools with a client that knows only the URL', async () => {
    const { household } = await householdWithPartner();
    const other = await seedHousehold(db.em());
    await addAccount(db.em(), other, { name: 'Other household' });

    const discovery = await discover();
    expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
    expect(discovery.grant_types_supported).not.toContain('client_credentials');
    const clientId = await register(discovery);

    // Signed out, the authorization request lands on the web app's consent page, which sends the
    // person through sign-in first.
    const signedOut = await request(app).get(authorizeUrl(discovery, clientId, { challenge: pkce().challenge }));
    expect(signedOut.status).toBe(302);
    expect(String(signedOut.headers['location'])).toContain('/oauth/consent?');

    const cookie = await signInAs(household.appuser);
    const { challenge, verifier } = pkce();
    const code = await consent(discovery, clientId, cookie, { challenge });
    const tokens = await exchange(discovery, clientId, code, verifier);
    expect(tokens.status).toBe(200);
    const { access_token: accessToken, expires_in: expiresIn, refresh_token: refreshToken } = tokens.body as { access_token: string; expires_in: number; refresh_token: string };
    expect(expiresIn).toBeLessThanOrEqual(15 * 60);
    expect(refreshToken).toMatch(/^wm_oauth_rt_/);

    const tools = await mcp(accessToken, { id: 3, jsonrpc: '2.0', method: 'tools/list' });
    expect((tools.body.result.tools as unknown[]).length).toBe(17);
    const names = accountNames(await listAccounts(accessToken));
    expect(names).toContain('Joint account');
    expect(names).not.toContain('Partner private');
    expect(names).not.toContain('Other household');

    // The refresh token rotates: the client gets a new one, and the new access token works.
    const refreshed = await refresh(discovery, clientId, refreshToken);
    expect(refreshed.status).toBe(200);
    const next = refreshed.body as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(refreshToken);
    expect((await listAccounts(next.access_token)).status).toBe(200);
  });

  it('never shows one person\'s token another person\'s data, in or out of the household', async () => {
    const { household, partner } = await householdWithPartner();
    await addAccount(db.em(), household, { isPrivate: true, name: 'Owner private', owner: household.appuser });
    const other = await seedHousehold(db.em());
    await addAccount(db.em(), other, { name: 'Other household' });

    const owner = await connect(household.appuser);
    const member = await connect(partner);
    const outsider = await connect(other.appuser);

    expect(accountNames(await listAccounts(owner.tokens.access_token))).toEqual(expect.arrayContaining(['Owner private']));
    expect(accountNames(await listAccounts(owner.tokens.access_token))).not.toContain('Partner private');
    expect(accountNames(await listAccounts(member.tokens.access_token))).toEqual(expect.arrayContaining(['Partner private', 'Joint account']));
    expect(accountNames(await listAccounts(member.tokens.access_token))).not.toContain('Owner private');
    const outsiderNames = accountNames(await listAccounts(outsider.tokens.access_token));
    expect(outsiderNames).toContain('Other household');
    expect(outsiderNames).not.toEqual(expect.arrayContaining(['Joint account']));
    expect(outsiderNames).not.toContain('Owner private');
  });

  it('refuses every token of a client the person revoked in Settings, and revives none on reconnecting', async () => {
    const { household } = await householdWithPartner();
    const { clientId, cookie, discovery, tokens } = await connect(household.appuser);
    expect((await listAccounts(tokens.access_token)).status).toBe(200);

    const listed = await request(app).get('/v1/user/mcp-clients').set('Cookie', cookie).expect(200);
    expect(listed.body.clients).toEqual([expect.objectContaining({ clientId, name: 'ChatGPT', redirectOrigins: ['https://chatgpt.example.test'], scopes: expect.arrayContaining(['mcp:read']) })]);

    await request(app).delete(`/v1/user/mcp-clients/${clientId}`).set('Cookie', cookie).expect(204);

    expect((await listAccounts(tokens.access_token)).status).toBe(401);
    expect((await refresh(discovery, clientId, tokens.refresh_token ?? '')).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).get('/v1/user/mcp-clients').set('Cookie', cookie).expect(200)).body.clients).toEqual([]);

    // Connecting again issues new tokens; the old access token stays refused.
    const { challenge, verifier } = pkce();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const code = await consent(discovery, clientId, cookie, { challenge });
    const again = (await exchange(discovery, clientId, code, verifier)).body as { access_token: string };
    expect((await listAccounts(again.access_token)).status).toBe(200);
    expect((await listAccounts(tokens.access_token)).status).toBe(401);
  });

  it('lets nobody list or revoke another person\'s clients', async () => {
    const { household, partner } = await householdWithPartner();
    const owner = await connect(household.appuser);
    const partnerCookie = await signInAs(partner);

    expect((await request(app).get('/v1/user/mcp-clients').set('Cookie', partnerCookie).expect(200)).body.clients).toEqual([]);
    await request(app).delete(`/v1/user/mcp-clients/${owner.clientId}`).set('Cookie', partnerCookie).expect(404);
    expect((await listAccounts(owner.tokens.access_token)).status).toBe(200);
  });

  it('answers a token the person did not grant mcp:read with 403', async () => {
    const { household } = await householdWithPartner();
    const { tokens } = await connect(household.appuser, { acceptScope: 'offline_access' });

    const response = await listAccounts(tokens.access_token);

    expect(response.status).toBe(403);
    expect(String(response.headers['www-authenticate'])).toContain('insufficient_scope');
  });

  it('requires PKCE, and the verifier that matches the challenge', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);

    const withoutPkce = await request(app).get(authorizeUrl(discovery, clientId, {})).set('Cookie', cookie);
    const error = new URL(String(withoutPkce.headers['location']));
    expect(`${error.origin}${error.pathname}`).toBe(REDIRECT_URI);
    expect(error.searchParams.get('error')).toBe('invalid_request');

    const { challenge } = pkce();
    const code = await consent(discovery, clientId, cookie, { challenge });
    expect((await exchange(discovery, clientId, code, pkce().verifier)).status).toBe(400);
  });

  it('refuses a session JWT and a made-up token at the MCP endpoint', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const sessionJwt = ((await request(app).get('/api/auth/token').set('Cookie', cookie).expect(200)).body as { token: string }).token;

    expect((await listAccounts(sessionJwt)).status).toBe(401);
    expect((await listAccounts('eyJhbGciOiJFZERTQSJ9.e30.c2ln')).status).toBe(401);
  });

  const sql = <T extends object>(text: string, values: unknown[] = []) => db.em().getConnection().execute<T[]>(text, values);

  /** When `clientId` lost its last grant, as the prune reads it: undefined while none was recorded. */
  async function grantEndOf(clientId: string): Promise<Date | null | undefined> {
    const [row] = await sql<{ lastGrantEndedAt: null | string }>('select "lastGrantEndedAt" from better_auth."mcpOAuthClientActivity" where "clientId" = ?', [clientId]);
    if (!row) return undefined;
    return row.lastGrantEndedAt === null ? null : new Date(row.lastGrantEndedAt);
  }

  /** Wait until `count` sessions wait on a lock. */
  async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [row] = await sql<{ waiting: number }>(`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
      if (row?.waiting === count) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} sessions to block`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  const isRegistered = async (clientId: string) => (await sql('select 1 from better_auth."oauthClient" where "clientId" = ?', [clientId])).length === 1;
  const DAY = 24 * 60 * 60 * 1000;

  it('asks for a fresh session to consent, and the authenticator code when the account has two-factor on', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);
    const login = loginOf.get(household.appuser.appuserKey);
    if (!login) throw new Error('no login');

    // A session from two days ago.
    await sql(`update better_auth.session set "createdAt" = now() - interval '2 days' where "userId" = ?`, [login.userId]);
    const stale = await postConsent(cookie, { accept: true, oauth_query: await consentQuery(discovery, clientId, cookie, { challenge: pkce().challenge }) });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('session_not_fresh');
    await sql(`update better_auth.session set "createdAt" = now() where "userId" = ?`, [login.userId]);

    // Two-factor on: no code, a wrong code, the right code.
    const secret = 'mcp-oauth-totp-test-secret';
    const encrypted = await symmetricEncrypt({ data: secret, key: process.env['BETTER_AUTH_SECRET'] ?? '' });
    await sql(`insert into better_auth."twoFactor" (id, secret, "backupCodes", "userId", verified) values (?, ?, ?, ?, true)`, [`tf-${login.userId}`, encrypted, '[]', login.userId]);
    await sql(`update better_auth."user" set "twoFactorEnabled" = true where id = ?`, [login.userId]);
    const query = () => consentQuery(discovery, clientId, cookie, { challenge: pkce().challenge });

    expect((await postConsent(cookie, { accept: true, oauth_query: await query() })).body.code).toBe('totp_required');
    expect((await postConsent(cookie, { accept: true, oauth_query: await query() }, '000000')).body.code).toBe('invalid_totp');
    // Declining needs neither.
    expect((await postConsent(cookie, { accept: false, oauth_query: await query() })).status).toBe(200);
    const { challenge, verifier } = pkce();
    const code = await consent(discovery, clientId, cookie, { challenge, totp: await createOTP(secret).totp() });
    expect((await exchange(discovery, clientId, code, verifier)).status).toBe(200);
  });

  it.each([
    ['a password change', async (cookie: string) => request(app).post('/api/auth/change-password').set('Origin', FRONTEND_URL).set('Cookie', cookie).send({ currentPassword: PASSWORD, newPassword: `${PASSWORD}!` }).expect(200)],
    ['signing out everywhere', async (cookie: string) => request(app).post('/api/auth/revoke-sessions').set('Origin', FRONTEND_URL).set('Cookie', cookie).send({}).expect(200)],
    ['signing out other devices', async (cookie: string) => request(app).post('/api/auth/revoke-other-sessions').set('Origin', FRONTEND_URL).set('Cookie', cookie).send({}).expect(200)],
  ])('takes back every OAuth grant on %s', async (_name, secure) => {
    const { household } = await householdWithPartner();
    const { clientId, cookie, tokens } = await connect(household.appuser);
    expect((await listAccounts(tokens.access_token)).status).toBe(200);

    await secure(cookie);

    expect((await listAccounts(tokens.access_token)).status).toBe(401);
    expect(await grantEndOf(clientId)).toBeInstanceOf(Date);
  });

  it('registers only https redirects, or http on a loopback host', async () => {
    const discovery = await discover();

    expect((await registration(discovery, ['evilapp://chatgpt.com/oauth/callback'])).status).toBe(400);
    expect((await registration(discovery, ['http://chatgpt.example.test/callback'])).status).toBe(400);
    expect((await registration(discovery, [REDIRECT_URI, 'com.example.app:/callback'])).status).toBe(400);
    expect((await registration(discovery, ['http://127.0.0.1:8976/callback'])).status).toBe(201);
    expect((await registration(discovery, ['http://localhost:33418/callback'])).status).toBe(201);
  });

  it('binds a token to an MCP request without a resource, and refuses DPoP at the token endpoint', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);

    const { challenge, verifier } = pkce();
    const code = await consent(discovery, clientId, cookie, { challenge, omitResource: true });
    const tokens = await exchange(discovery, clientId, code, verifier, { omitResource: true });
    expect(tokens.status).toBe(200);
    expect((await listAccounts((tokens.body as { access_token: string }).access_token)).status).toBe(200);

    const second = pkce();
    const secondCode = await consent(discovery, clientId, cookie, { challenge: second.challenge });
    const dpop = await request(app).post(pathOf(discovery.token_endpoint)).set('DPoP', 'eyJhbGciOiJFUzI1NiJ9.e30.c2ln').type('form')
      .send({ client_id: clientId, code: secondCode, code_verifier: second.verifier, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, resource: discovery.resource });
    expect(dpop.status).toBe(400);
    expect(dpop.body.error).toBe('invalid_dpop_proof');
  });

  it('refuses a code exchanged for another redirect than it was issued to', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);
    const { challenge, verifier } = pkce();
    const code = await consent(discovery, clientId, cookie, { challenge });

    const response = await exchange(discovery, clientId, code, verifier, { redirectUri: 'https://chatgpt.example.test/connector/oauth/other' });

    expect(response.status).toBe(400);
  });

  it('stops the first exchange\'s access token at once when the authorization code is replayed', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);
    const { challenge, verifier } = pkce();
    const code = await consent(discovery, clientId, cookie, { challenge });
    const first = (await exchange(discovery, clientId, code, verifier)).body as { access_token: string };
    expect((await listAccounts(first.access_token)).status).toBe(200);

    expect((await exchange(discovery, clientId, code, verifier)).status).toBe(400);

    expect((await listAccounts(first.access_token)).status).toBe(401);
  });

  it('refuses and revokes a grant once its person is in another household', async () => {
    const { household } = await householdWithPartner();
    const { clientId, cookie, tokens } = await connect(household.appuser);
    const em = db.em();
    const elsewhere = await seedHousehold(em);
    await em.nativeUpdate(AppuserTenant, { appuserKey: household.appuser }, { recordActive: false });
    em.create(AppuserTenant, { appuserKey: await em.findOneOrFail(Appuser, { appuserKey: { $eq: household.appuser.appuserKey } }), recordActive: true, tenantKey: elsewhere.tenant }, { partial: true });
    await em.flush();

    expect((await listAccounts(tokens.access_token)).status).toBe(401);
    expect((await request(app).get('/v1/user/mcp-clients').set('Cookie', cookie).expect(200)).body.clients).toEqual([]);
    expect(await grantEndOf(clientId)).toBeInstanceOf(Date);
  });

  it('never issues a code without the consent step, even for a client the person allowed before', async () => {
    const { household } = await householdWithPartner();
    const { clientId, cookie, discovery } = await connect(household.appuser);
    const login = loginOf.get(household.appuser.appuserKey);
    if (!login) throw new Error('no login');
    // Since then: the session is 20 days old and two-factor is on.
    await sql(`update better_auth.session set "createdAt" = now() - interval '20 days' where "userId" = ?`, [login.userId]);
    await sql(`update better_auth."user" set "twoFactorEnabled" = true where id = ?`, [login.userId]);

    const silent = await request(app).get(`${authorizeUrl(discovery, clientId, { challenge: pkce().challenge })}&prompt=none`).set('Cookie', cookie);
    expect(silent.status).toBe(302);
    const silentTarget = new URL(String(silent.headers['location']));
    expect(`${silentTarget.origin}${silentTarget.pathname}`).toBe(REDIRECT_URI);
    expect(silentTarget.searchParams.get('error')).toBe('consent_required');
    expect(silentTarget.searchParams.get('code')).toBeNull();

    const plain = await request(app).get(authorizeUrl(discovery, clientId, { challenge: pkce().challenge })).set('Cookie', cookie);
    const plainTarget = new URL(String(plain.headers['location']));
    expect(`${plainTarget.origin}${plainTarget.pathname}`).toBe(new URL('oauth/consent', `${FRONTEND_URL}/`).toString());

    // better-auth's continue step dispatches an authorization of its own: that too ends on the consent page.
    const continued = await request(app).post('/api/auth/oauth2/continue').set('Origin', FRONTEND_URL).set('Cookie', cookie)
      .send({ oauth_query: plainTarget.search.slice(1), postLogin: true });
    expect(JSON.stringify(continued.body)).not.toContain('code=');

    // And the consent itself now asks for a fresh session.
    expect((await postConsent(cookie, { accept: true, oauth_query: plainTarget.search.slice(1) })).body.code).toBe('session_not_fresh');
  });

  it('refuses a refresh that drops offline_access, so every token from the grant stays tied to its refresh tokens', async () => {
    const { household } = await householdWithPartner();
    const { clientId, discovery, tokens } = await connect(household.appuser);

    const narrowed = await request(app).post(pathOf(discovery.token_endpoint)).type('form')
      .send({ client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: discovery.resource, scope: 'mcp:read' });

    expect(narrowed.status).toBe(400);
    expect(narrowed.body.error).toBe('invalid_scope');
  });

  it('keeps better-auth\'s own consent routes closed: grants are managed in Settings', async () => {
    const { household } = await householdWithPartner();
    const { clientId, cookie } = await connect(household.appuser);

    expect((await request(app).get('/api/auth/oauth2/get-consents').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get(`/api/auth/oauth2/get-consent?id=${clientId}`).set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).post('/api/auth/oauth2/delete-consent').set('Origin', FRONTEND_URL).set('Cookie', cookie).send({ id: clientId })).status).toBe(403);
    expect((await request(app).post('/api/auth/oauth2/update-consent').set('Origin', FRONTEND_URL).set('Cookie', cookie).send({ id: clientId, update: { scopes: ['mcp:read'] } })).status).toBe(403);
  });

  it('counts a disconnected client\'s seven days from its disconnection, not its registration, until someone consents again', async () => {
    const { household } = await householdWithPartner();
    const { clientId, cookie, discovery } = await connect(household.appuser);
    expect(await grantEndOf(clientId)).toBeUndefined();
    // Registered a month ago, disconnected in Settings today.
    await sql(`update better_auth."oauthClient" set "createdAt" = now() - interval '30 days' where "clientId" = ?`, [clientId]);
    await request(app).delete(`/v1/user/mcp-clients/${clientId}`).set('Cookie', cookie).expect(204);
    const disconnected = await grantEndOf(clientId);
    expect(disconnected).toBeInstanceOf(Date);
    expect(Math.abs((disconnected?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);

    // Other tests' clients share this database, so only this one's fate is checked.
    await pruneUnusedMcpOAuthClients(db.em(), new Date(Date.now() + 6 * DAY));
    expect(await isRegistered(clientId)).toBe(true);

    // Connecting again clears it; the client is in use again.
    await consent(discovery, clientId, cookie, { challenge: pkce().challenge });
    expect(await grantEndOf(clientId)).toBeNull();

    await request(app).delete(`/v1/user/mcp-clients/${clientId}`).set('Cookie', cookie).expect(204);
    await pruneUnusedMcpOAuthClients(db.em(), new Date(Date.now() + 8 * DAY));
    expect(await isRegistered(clientId)).toBe(false);
  });

  it('records no disconnection while another person still has the client connected', async () => {
    const { household, partner } = await householdWithPartner();
    const { clientId, cookie, discovery } = await connect(household.appuser);
    await consent(discovery, clientId, await signInAs(partner), { challenge: pkce().challenge });

    await request(app).delete(`/v1/user/mcp-clients/${clientId}`).set('Cookie', cookie).expect(204);

    expect(await grantEndOf(clientId)).toBeUndefined();
  });

  it('answers invalid_client to a consent for a client removed since the consent page opened', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);
    const oauthQuery = await consentQuery(discovery, clientId, cookie, { challenge: pkce().challenge });
    await pruneUnusedMcpOAuthClients(db.em(), new Date(Date.now() + 8 * DAY));
    expect(await isRegistered(clientId)).toBe(false);

    const response = await postConsent(cookie, { accept: true, oauth_query: oauthQuery });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'invalid_client', error_description: expect.any(String) });
  });

  it('answers invalid_client to a consent sent while the prune is removing the client', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);
    const oauthQuery = await consentQuery(discovery, clientId, cookie, { challenge: pkce().challenge });

    // The prune's transaction, holding the client's row while it removes it.
    const removal = db.em();
    await removal.begin();
    const context = removal.getTransactionContext();
    await removal.getConnection().execute('select 1 from better_auth."oauthClient" where "clientId" = ? for update', [clientId], 'all', context);
    const answered = postConsent(cookie, { accept: true, oauth_query: oauthQuery }).then((response) => response);
    await waitForLockWaiters(1);
    for (const table of ['oauthClientResource', 'oauthClient']) {
      await removal.getConnection().execute(`delete from better_auth."${table}" where "clientId" = ?`, [clientId], 'run', context);
    }
    await removal.commit();

    const response = await answered;
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'invalid_client' });
  });

  it('answers invalid_client to a consent whose client is removed after the check, as better-auth stores it', async () => {
    const { household } = await householdWithPartner();
    const cookie = await signInAs(household.appuser);
    const discovery = await discover();
    const clientId = await register(discovery);
    const oauthQuery = await consentQuery(discovery, clientId, cookie, { challenge: pkce().challenge });

    // Hold back every consent insert, so the client goes between the hook's check and the insert.
    const removal = db.em();
    await removal.begin();
    const context = removal.getTransactionContext();
    await removal.getConnection().execute('lock table better_auth."oauthConsent" in share mode', [], 'run', context);
    const answered = postConsent(cookie, { accept: true, oauth_query: oauthQuery }).then((response) => response);
    await waitForLockWaiters(1);
    for (const table of ['oauthClientResource', 'oauthClient']) {
      await removal.getConnection().execute(`delete from better_auth."${table}" where "clientId" = ?`, [clientId], 'run', context);
    }
    await removal.commit();

    const response = await answered;
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'invalid_client' });
  });

  it('records the disconnection when the last two people disconnect one client at the same moment', async () => {
    const { household, partner } = await householdWithPartner();
    const { clientId, cookie, discovery } = await connect(household.appuser);
    const partnerCookie = await signInAs(partner);
    await consent(discovery, clientId, partnerCookie, { challenge: pkce().challenge });

    // Both revocations get as far as the access tokens before either commits.
    const hold = db.em();
    await hold.begin();
    await hold.getConnection().execute('lock table better_auth."oauthAccessToken" in share mode', [], 'run', hold.getTransactionContext());
    const revokes = Promise.all([cookie, partnerCookie].map((session) => request(app).delete(`/v1/user/mcp-clients/${clientId}`).set('Cookie', session).then((response) => response.status)));
    await waitForLockWaiters(2);
    await hold.commit();

    expect(await revokes).toEqual([204, 204]);
    expect(await grantEndOf(clientId)).toBeInstanceOf(Date);
  });

  it('names the household in a token by an opaque reference, never its key', async () => {
    const { household } = await householdWithPartner();
    const { tokens } = await connect(household.appuser);

    const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;

    expect(claims['wm_household']).toEqual(expect.stringMatching(/^[\w-]{43}$/));
    expect(claims['wm_household']).not.toBe(String(household.tenant.tenantKey));
  });
});
