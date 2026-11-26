import { RequestContext } from '@mikro-orm/postgresql';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addAccount, addPartner, addShare, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { AppuserTenant } from '@entity/AppuserTenant';
import { AssistantAuditLog, AssistantAuditSource } from '@entity/AssistantAuditLog';
import { errorHandler } from '@middleware/error-handler';
import mcpRoutes from '@route/mcp';
import mcpOAuthMetadataRoutes from '@route/mcp-oauth-metadata';
import { createApiToken } from '@service/api-token/api-token.service';
import { getMcpOAuthServerMetadata } from '@service/auth/better-auth';
import { verifyMcpOAuthAccessToken } from '@service/mcp/mcp-oauth-token.service';
import { resetMcpToolCallWindows } from '@service/mcp/mcp-rate-limit.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
// The token's signature, audience and consent are checked in `mcp-oauth.better-auth.test.ts`
// against the real authorization server. Here the check is stood in for, to test what the MCP
// server does with the person it names.
vi.mock('@service/mcp/mcp-oauth-token.service', () => ({ verifyMcpOAuthAccessToken: vi.fn() }));

const db = useTestDatabase();
const verify = vi.mocked(verifyMcpOAuthAccessToken);

function app() {
  const host = express();
  host.use((_req, _res, next) => {
    RequestContext.create(db.orm.em, next);
  });
  host.use(express.json());
  host.use('/v1/mcp', mcpRoutes);
  host.use('/.well-known', mcpOAuthMetadataRoutes);
  host.use(errorHandler);
  return request(host);
}

const initialize = {
  id: 1,
  jsonrpc: '2.0',
  method: 'initialize',
  params: { capabilities: {}, clientInfo: { name: 'chatgpt', version: '1.0.0' }, protocolVersion: '2025-11-25' },
};
const listAccounts = { id: 2, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'list_accounts' } };

const post = (bearer: null | string, body: unknown) => {
  const agent = app().post('/v1/mcp').set('Accept', 'application/json, text/event-stream').set('Content-Type', 'application/json');
  return bearer === null ? agent.send(body as object) : agent.set('Authorization', `Bearer ${bearer}`).send(body as object);
};

const accountNames = (response: request.Response) =>
  (response.body.result.structuredContent as { accounts: { name: string }[] }).accounts.map((account) => account.name);

describe('OAuth on the MCP server', () => {
  beforeEach(() => {
    DI.em = db.em();
    resetMcpToolCallWindows();
    verify.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('with MCP_OAUTH_ENABLED off (the default)', () => {
    it('serves no OAuth metadata', async () => {
      const paths = ['/.well-known/oauth-protected-resource/v1/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server/api/auth', '/.well-known/oauth-authorization-server'];
      const statuses = await Promise.all(paths.map(async (path) => (await app().get(path)).status));
      expect(statuses).toEqual([404, 404, 404, 404]);
    });

    it('rejects an OAuth access token without looking at it, and points no client at OAuth', async () => {
      verify.mockResolvedValue({ caller: { clientId: 'chatgpt', scopes: ['mcp:read'], userId: 'anyone' }, ok: true });

      const response = await post('eyJhbGciOiJFZERTQSJ9.e30.c2ln', initialize);

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBeUndefined();
      expect(verify).not.toHaveBeenCalled();
    });

    it('keeps accepting personal API tokens', async () => {
      const household = await seedHousehold(db.em());
      const { token } = await createApiToken({ appuser: household.appuser, expiresInDays: 30, name: 'AI client', scopes: ['mcp:read'], tenant: household.tenant }, db.em());

      expect((await post(token, initialize)).status).toBe(200);
    });
  });

  describe('with MCP_OAUTH_ENABLED=true', () => {
    beforeEach(() => {
      vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
    });

    it('answers an unauthenticated request with a challenge naming the protected resource metadata', async () => {
      const response = await post(null, initialize);

      expect(response.status).toBe(401);
      const challenge = String(response.headers['www-authenticate']);
      expect(challenge).toMatch(/^Bearer /);
      const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
      expect(metadataUrl).toMatch(/\/\.well-known\/oauth-protected-resource\/v1\/mcp$/);
      expect(challenge).toContain('scope="mcp:read"');

      const metadata = await app().get(new URL(metadataUrl ?? '').pathname).expect(200);
      expect(metadata.body).toMatchObject({
        authorization_servers: [expect.stringMatching(/\/api\/auth$/)],
        bearer_methods_supported: ['header'],
        resource: expect.stringMatching(/\/v1\/mcp$/),
        scopes_supported: ['mcp:read'],
      });
    });

    it('serves the authorization server metadata at the issuer path and the bare path only', async () => {
      vi.mocked(getMcpOAuthServerMetadata).mockResolvedValue({ issuer: 'http://localhost:3001/api/auth' });

      expect((await app().get('/.well-known/oauth-authorization-server/api/auth').expect(200)).body).toEqual({ issuer: 'http://localhost:3001/api/auth' });
      await app().get('/.well-known/oauth-authorization-server').expect(200);
      await app().get('/.well-known/oauth-authorization-server/somewhere-else').expect(404);
    });

    it('lets an OAuth client read its person\'s household, never another household or a member\'s private account', async () => {
      const em = db.em();
      const household = await seedHousehold(em);
      const partner = await addPartner(em, household);
      await addAccount(em, household, { name: 'Joint savings' });
      await addAccount(em, household, { isPrivate: true, name: 'Partner private', owner: partner });
      const shared = await addAccount(em, household, { isPrivate: true, name: 'Partner shared with me', owner: partner });
      await addShare(em, household, shared, household.appuser, 'read');
      const other = await seedHousehold(em);
      await addAccount(em, other, { name: 'Other household' });
      verify.mockResolvedValue({ caller: { clientId: 'chatgpt-client', scopes: ['mcp:read', 'offline_access'], userId: household.appuser.externalUserId }, ok: true });

      const response = await post('an-oauth-access-token', listAccounts);

      expect(response.status).toBe(200);
      const names = accountNames(response);
      expect(names).toEqual(expect.arrayContaining(['Joint savings', 'Partner shared with me']));
      expect(names).not.toContain('Partner private');
      expect(names).not.toContain('Other household');
      // The same data as text, for clients that do not read structured results.
      expect(JSON.parse(response.body.result.content[0].text)).toEqual(response.body.result.structuredContent);
    });

    it('offers an OAuth client the read tools only, each annotated read-only', async () => {
      const household = await seedHousehold(db.em());
      verify.mockResolvedValue({ caller: { clientId: 'chatgpt-client', scopes: ['mcp:read'], userId: household.appuser.externalUserId }, ok: true });

      const response = await post('an-oauth-access-token', { id: 3, jsonrpc: '2.0', method: 'tools/list' });

      const tools = response.body.result.tools as { annotations?: { readOnlyHint?: boolean }; name: string }[];
      expect(tools).toHaveLength(17);
      expect(tools.some((tool) => tool.name.startsWith('propose_'))).toBe(false);
      expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    });

    it('records each call with the OAuth client and no token', async () => {
      const household = await seedHousehold(db.em());
      verify.mockResolvedValue({ caller: { clientId: 'chatgpt-client', scopes: ['mcp:read'], userId: household.appuser.externalUserId }, ok: true });

      await post('an-oauth-access-token', listAccounts);

      const [entry, ...rest] = await db.em().find(AssistantAuditLog, {});
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({ oauthClientId: 'chatgpt-client', source: AssistantAuditSource.MCP, toolName: 'list_accounts' });
      expect(entry?.apiTokenKey ?? null).toBeNull();
    });

    it('answers a revoked or invalid token with 401 and an invalid_token challenge', async () => {
      verify.mockResolvedValue({ error: 'invalid_token', ok: false });

      const response = await post('a-revoked-access-token', initialize);

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    });

    it('answers a token without mcp:read with 403 and an insufficient_scope challenge', async () => {
      verify.mockResolvedValue({ error: 'insufficient_scope', ok: false });

      const response = await post('an-offline-access-only-token', initialize);

      expect(response.status).toBe(403);
      expect(response.headers['www-authenticate']).toContain('error="insufficient_scope"');
    });

    it('refuses a token whose person has no app account or no household', async () => {
      verify.mockResolvedValue({ caller: { clientId: 'chatgpt-client', scopes: ['mcp:read'], userId: 'no-such-user' }, ok: true });
      expect((await post('a-token', initialize)).status).toBe(401);

      const household = await seedHousehold(db.em());
      await db.em().nativeUpdate(AppuserTenant, { appuserKey: household.appuser }, { recordActive: false });
      verify.mockResolvedValue({ caller: { clientId: 'chatgpt-client', scopes: ['mcp:read'], userId: household.appuser.externalUserId }, ok: true });
      expect((await post('a-token', initialize)).status).toBe(401);
    });

    it('still accepts a personal API token, and its 401 points at OAuth too', async () => {
      const household = await seedHousehold(db.em());
      const { token } = await createApiToken({ appuser: household.appuser, expiresInDays: 30, name: 'AI client', scopes: ['mcp:read'], tenant: household.tenant }, db.em());

      expect((await post(token, initialize)).status).toBe(200);
      const wrong = await post(`${token.slice(0, -4)}xxxx`, initialize);
      expect(wrong.status).toBe(401);
      expect(wrong.headers['www-authenticate']).toContain('resource_metadata=');
      expect(verify).not.toHaveBeenCalled();
    });

    it('stays off while the MCP server itself is off', async () => {
      vi.stubEnv('MCP_ENABLED', 'false');

      await app().get('/.well-known/oauth-protected-resource/v1/mcp').expect(404);
      expect((await post('a-token', initialize)).status).toBe(404);
    });
  });
});
