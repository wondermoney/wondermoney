import type { Request, Response } from 'express';
import { z } from 'zod';

import { DI } from '@app/database/di';
import { instanceName } from '@config/instance-name';
import { AssistantAuditLog, AssistantAuditSource } from '@entity/AssistantAuditLog';
import { authedContext } from '@middleware/authed-context';
import { getMcpOAuthIssuer, getMcpOAuthServerMetadata, listMcpOAuthGrants, revokeMcpOAuthGrant } from '@service/auth/better-auth';
import { MCP_OAUTH_SCOPES, mcpOAuthResourceIfEnabled } from '@service/mcp/mcp-oauth-config';
import { NotFoundError } from '@utils/errors';
import { zParse } from '@validators/parser';

const mcpCallsQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).strict(),
});

/**
 * `GET /v1/user/mcp-calls` — the signed-in member's recent MCP tool calls.
 *
 * The settings panel shows the tool name and when it ran. Amounts, descriptions and the
 * token's own value are deliberately absent: the audit row never stores them (`source = 'mcp'`,
 * `tool_name`, a safe metadata whitelist).
 */
export async function listMcpCalls(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    query: { limit },
  } = await zParse(mcpCallsQuerySchema, req);
  const calls = await DI.em.find(
    AssistantAuditLog,
    {
      appuserKey: user,
      deletedAt: null,
      source: AssistantAuditSource.MCP,
      tenantKey: tenant,
    },
    { limit, orderBy: { createdAt: 'desc' } },
  );
  return res.json({
    calls: calls.map((call) => ({
      createdAt: call.createdAt.toISOString(),
      toolName: call.toolName ?? null,
    })),
  });
}

/**
 * `GET /v1/user/mcp-clients` — the OAuth clients (ChatGPT, Claude, …) the signed-in person has let
 * into the MCP server, with when they connected and last called a tool. Only the person's own
 * grants: another member's are theirs to see and revoke.
 */
export async function listMcpOAuthClients(req: Request, res: Response) {
  const { user } = authedContext(req);
  const grants = await listMcpOAuthGrants(user.externalUserId);
  const lastCalls = await Promise.all(grants.map((grant) => DI.em.findOne(
    AssistantAuditLog,
    { appuserKey: user, deletedAt: null, oauthClientId: grant.clientId, source: AssistantAuditSource.MCP },
    { fields: ['createdAt'], orderBy: { createdAt: 'desc' } },
  )));
  return res.json({
    clients: grants.map((grant, index) => ({
      clientId: grant.clientId,
      connectedAt: grant.connectedAt.toISOString(),
      lastUsedAt: lastCalls[index]?.createdAt.toISOString() ?? null,
      name: grant.name,
      redirectOrigins: grant.redirectOrigins,
      scopes: grant.scopes,
    })),
  });
}

const mcpOAuthClientParamsSchema = z.object({
  params: z.object({ clientId: z.string().trim().min(1).max(255) }),
});

/**
 * `DELETE /v1/user/mcp-clients/:clientId` — revoke one OAuth client's access to the MCP server
 * for the signed-in person: the consent and every token it issued for them. The client's next
 * call gets 401. 404 when the person had given that client nothing.
 */
export async function revokeMcpOAuthClient(req: Request, res: Response) {
  const { user } = authedContext(req);
  const {
    params: { clientId },
  } = await zParse(mcpOAuthClientParamsSchema, req);
  if (!await revokeMcpOAuthGrant(user.externalUserId, clientId)) throw new NotFoundError('OAuth client not found');
  return res.sendStatus(204);
}

function sendMetadata(res: Response, body: unknown) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.json(body);
}

/**
 * `GET /.well-known/oauth-protected-resource[/v1/mcp]` — RFC 9728 protected resource metadata for
 * the MCP server: its resource identifier and the authorization server that issues tokens for
 * it. A 401 from `POST /v1/mcp` points here. 404 while `MCP_OAUTH_ENABLED` is off.
 */
export async function getMcpProtectedResourceMetadata(_req: Request, res: Response) {
  const resource = mcpOAuthResourceIfEnabled();
  if (!resource) throw new NotFoundError();
  return sendMetadata(res, {
    authorization_servers: [await getMcpOAuthIssuer()],
    bearer_methods_supported: ['header'],
    resource,
    resource_name: instanceName(),
    // `offline_access` too: an MCP client asks for the scopes listed here, and gets a refresh
    // token only with that one.
    scopes_supported: [...MCP_OAUTH_SCOPES],
  });
}

/**
 * `GET /.well-known/oauth-authorization-server[/api/auth]` — RFC 8414 authorization server
 * metadata, as better-auth's OAuth provider describes itself: the authorization, token,
 * registration and revocation endpoints under `/api/auth/oauth2`, PKCE with S256 only. The issuer
 * is better-auth's base URL, so the path form (`/.well-known/oauth-authorization-server/api/auth`)
 * is the one RFC 8414 discovery asks for; the bare path, and better-auth's own copy under its
 * base path (`/api/auth/.well-known/oauth-authorization-server`, served from here too so the two
 * never differ), serve the same document. 404 while `MCP_OAUTH_ENABLED` is off.
 */
export async function getMcpAuthorizationServerMetadata(req: Request, res: Response) {
  if (!mcpOAuthResourceIfEnabled()) throw new NotFoundError();
  const issuerPath = new URL(await getMcpOAuthIssuer()).pathname.replace(/\/+$/, '');
  const suffix = req.path.replace(/^\/oauth-authorization-server/, '').replace(/\/+$/, '');
  if (suffix !== '' && suffix !== issuerPath) throw new NotFoundError();
  return sendAuthorizationServerMetadata(res);
}

/** `GET /api/auth/.well-known/oauth-authorization-server`: the same document, at the issuer's own path. */
export async function getMcpAuthorizationServerMetadataAtIssuer(_req: Request, res: Response) {
  if (!mcpOAuthResourceIfEnabled()) throw new NotFoundError();
  return sendAuthorizationServerMetadata(res);
}

async function sendAuthorizationServerMetadata(res: Response) {
  const metadata = await getMcpOAuthServerMetadata();
  if (!metadata) throw new NotFoundError();
  // `/v1/mcp` accepts bearer tokens only, and the token endpoint refuses DPoP proofs
  // (services/auth/mcp-oauth.ts), so DPoP is not advertised.
  const { dpop_signing_alg_values_supported: _dpop, ...advertised } = metadata;
  return sendMetadata(res, advertised);
}
