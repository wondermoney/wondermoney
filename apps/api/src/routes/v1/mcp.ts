import express from 'express';

import { requireMcpEnabled, requireMcpToken } from '@middleware/mcp-auth';
import { apiTokenRateLimit, mcpBearerRateLimit } from '@middleware/rate-limit';
import { handleMcpRequest, methodNotAllowed } from '@service/mcp/mcp.service';

const router = express.Router();

// The instance switch gates every method, so a disabled instance answers 404 rather than
// leaking that the route exists.
router.use(requireMcpEnabled);

/*
 * Stateless Streamable HTTP. While OAuth is on, a bearer call is counted per address first
 * (`mcpBearer`, in place of the backstop). The token is resolved before the `apiToken` limiter so
 * that family keys its bucket on the token's own row (see `middleware/rate-limit.ts`).
 */
router.post('/', mcpBearerRateLimit(), requireMcpToken, apiTokenRateLimit(), handleMcpRequest);

// A stateless server has no stream to resume and no session to delete.
router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

export default router;
