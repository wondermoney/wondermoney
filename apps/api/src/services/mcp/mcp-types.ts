import type { Appuser } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';

/** The resolved caller of an MCP request, set by `requireMcpToken`. */
export interface McpRequestIdentity {
  apiTokenKey: number;
  appuser: Appuser;
  tenant: Tenant;
}
