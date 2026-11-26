import { createHash, randomBytes } from 'node:crypto';

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

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
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
  });

  let people = 0;
  /** A better-auth login bound to `appuser`, signed in: its session cookie. */
  async function signInAs(appuser: Appuser): Promise<string> {
    people += 1;
    const email = `person${people}@example.test`;
    const signUp = await request(app).post('/api/auth/sign-up/email').set('Origin', FRONTEND_URL).send({ email, name: email, password: PASSWORD }).expect(200);
    const userId = (signUp.body as { user: { id: string } }).user.id;
    await db.em().nativeUpdate(Appuser, { appuserKey: appuser.appuserKey }, { emailAddress: email, externalUserId: userId });
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

  async function register(discovery: Discovery, name = 'ChatGPT'): Promise<string> {
    const response = await request(app).post(pathOf(discovery.registration_endpoint)).send({
      client_name: name,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [REDIRECT_URI],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    expect(response.status).toBe(201);
    return (response.body as { client_id: string }).client_id;
  }

  function authorizeUrl(discovery: Discovery, clientId: string, input: { challenge?: string; scope?: string; state?: string }) {
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, resource: discovery.resource, response_type: 'code', scope: input.scope ?? 'mcp:read offline_access', state: input.state ?? 'state-1' });
    if (input.challenge) {
      params.set('code_challenge', input.challenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${pathOf(discovery.authorization_endpoint)}?${params.toString()}`;
  }

  /** The person signs in, sees the consent page and accepts: the code the client receives. */
  async function consent(discovery: Discovery, clientId: string, cookie: string, input: { acceptScope?: string; challenge: string; scope?: string }): Promise<string> {
    const authorize = await request(app).get(authorizeUrl(discovery, clientId, input)).set('Cookie', cookie);
    expect(authorize.status).toBe(302);
    const consentPage = new URL(String(authorize.headers['location']));
    expect(`${consentPage.origin}${consentPage.pathname}`).toBe(new URL('oauth/consent', `${FRONTEND_URL}/`).toString());

    const accepted = await request(app).post('/api/auth/oauth2/consent').set('Origin', FRONTEND_URL).set('Cookie', cookie)
      .send({ accept: true, oauth_query: consentPage.search.slice(1), ...(input.acceptScope ? { scope: input.acceptScope } : {}) })
      .expect(200);
    const callback = new URL((accepted.body as { url: string }).url);
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('state-1');
    return callback.searchParams.get('code') ?? '';
  }

  async function exchange(discovery: Discovery, clientId: string, code: string, verifier: string) {
    return request(app).post(pathOf(discovery.token_endpoint)).type('form').send({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      resource: discovery.resource,
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
    expect(listed.body.clients).toEqual([expect.objectContaining({ clientId, name: 'ChatGPT', redirectHost: 'chatgpt.example.test', scopes: expect.arrayContaining(['mcp:read']) })]);

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
});
