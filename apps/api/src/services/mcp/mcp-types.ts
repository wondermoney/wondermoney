import type { ApiTokenScope } from '@entity/ApiToken';
import type { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';

/**
 * How an MCP caller proved who it is: a personal API token (`wm_pat_…`), or an OAuth access token
 * a client such as ChatGPT obtained through the person's consent.
 */
export type McpCredential =
  | { apiTokenKey: number; kind: 'api_token' }
  | { clientId: string; kind: 'oauth'; userId: string };

/** The resolved caller of an MCP request, set by `requireMcpToken`. */
export interface McpRequestIdentity {
  appuser: Appuser;
  credential: McpCredential;
  /**
   * `mcp:read` exposes the read tools, `mcp:propose` the `propose_*` tools. An OAuth token only
   * ever carries `mcp:read`.
   */
  scopes: readonly ApiTokenScope[];
  tenant: Tenant;
}

/**
 * The key one credential's budgets are counted under: the request limiter's `apiToken` family
 * and the per-minute tool-call cap. An OAuth grant is one client for one person, so two people
 * using ChatGPT never share a budget, and neither shares one with a personal token.
 */
export function mcpCredentialKey(credential: McpCredential): string {
  return credential.kind === 'api_token' ? `t:${credential.apiTokenKey}` : `o:${credential.clientId}:${credential.userId}`;
}
