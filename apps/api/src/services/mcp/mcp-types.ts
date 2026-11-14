import type { ApiTokenScope } from '@entity/ApiToken';
import type { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';

/** The resolved caller of an MCP request, set by `requireMcpToken`. */
export interface McpRequestIdentity {
  apiTokenKey: number;
  appuser: Appuser;
  /** `mcp:read` exposes the read tools, `mcp:propose` the `propose_*` tools. */
  scopes: readonly ApiTokenScope[];
  tenant: Tenant;
}
