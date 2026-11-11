import type { ApiTokenScope } from '@entity/ApiToken';
import type { AuthContext } from '@service/auth/better-auth';
import type { McpRequestIdentity } from '@service/mcp/mcp-types';
import { Appuser } from '../database/entity/Appuser';
import { Tenant } from '../database/entity/Tenant';
import type { Enqueue } from '@service/queue/enqueue';

/** The authenticated personal-token context, set by `requireAuth` for `wm_pat_` bearers. */
export interface ApiTokenRequestContext {
  apiTokenKey: number;
  scopes: ApiTokenScope[];
}

// type MySession = Express.Session & SessionContainerInterface;

declare global {
  namespace Express {
    interface User extends Appuser {}
    interface Request {
      apiToken?: ApiTokenRequestContext;
      authUser?: AuthContext;
      user?: User;
      tenant?: Tenant;
      enqueue?: Enqueue;
      /** The token and household behind an MCP request, set by `requireMcpToken`. */
      mcpIdentity?: McpRequestIdentity;
    }
    // interface Session extends SessionContainerInterface {}
    // interface Request {
    //   // session?: SessionContainerInterface;
    //   session?: MySession;
    // }
    // interface SessionRequest extends Request {
    //   session?: SessionContainerInterface;
    // }
  }
}

// declare module 'express-session' {
//   interface SessionData extends SessionContainerInterface {}
// }

// declare module 'express-serve-static-core' {
//   interface Session extends SessionContainerInterface {}
// }
