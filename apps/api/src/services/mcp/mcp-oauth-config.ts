import { isMcpOAuthRequested, mcpOAuthResource } from '@config/mcp';
import { BACKEND_URL } from '@utils/constants';

type Env = Readonly<Record<string, string | undefined>>;

/** The one scope an OAuth client can be granted on the MCP server: the read tools. */
export const MCP_OAUTH_READ_SCOPE = 'mcp:read';

/**
 * Every scope the authorization server knows. `offline_access` asks for a refresh token, so a
 * client keeps access without sending the person back through consent every quarter hour. The
 * `propose_*` tools have no OAuth scope: they stay behind a personal API token.
 */
export const MCP_OAUTH_SCOPES = [MCP_OAUTH_READ_SCOPE, 'offline_access'] as const;

/**
 * The access-token claim naming the household the person consented for, as an opaque reference
 * (`mcpOAuthHouseholdReference` in services/auth/better-auth.ts), never the tenant key itself.
 * `middleware/mcp-auth.ts` refuses the token once the person is in another household.
 */
export const MCP_OAUTH_HOUSEHOLD_CLAIM = 'wm_household';

/** How long an OAuth access token lives. Short: a refresh token (rotated on use) renews it. */
export const MCP_OAUTH_ACCESS_TOKEN_SECONDS = 15 * 60;

/**
 * The MCP resource identifier when OAuth for the MCP server is on (`MCP_OAUTH_ENABLED=true`, the
 * MCP server on, and an API address that can be an OAuth resource), else null. The single
 * switch every OAuth surface reads: the metadata documents, the better-auth plugin, the token
 * check on `POST /v1/mcp` and `GET /v1/instance`.
 */
export function isMcpOAuthEnabled(env: Env = process.env, apiUrl: string = BACKEND_URL): boolean {
  return mcpOAuthResourceIfEnabled(env, apiUrl) !== null;
}

export function mcpOAuthResourceIfEnabled(env: Env = process.env, apiUrl: string = BACKEND_URL): null | string {
  return isMcpOAuthRequested(env) ? mcpOAuthResource(apiUrl) : null;
}

/**
 * The RFC 9728 protected resource metadata URL for `resource`: the well-known suffix inserted
 * between the host and the resource's path (`https://api.example.com/.well-known/oauth-protected-resource/v1/mcp`).
 */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}
