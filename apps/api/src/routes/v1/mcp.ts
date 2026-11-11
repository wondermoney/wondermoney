import express from 'express';

import { requireMcpEnabled, requireMcpToken } from '@middleware/mcp-auth';
import { apiTokenRateLimit } from '@middleware/rate-limit';
import { handleMcpRequest, methodNotAllowed } from '@service/mcp/mcp.service';

const router = express.Router();

// The instance switch gates every method, so a disabled instance answers 404 rather than
// leaking that the route exists.
router.use(requireMcpEnabled);

/*
 * Stateless Streamable HTTP. The token is resolved before the limiter so the `apiToken`
 * family keys its bucket on the token's own row (see `middleware/rate-limit.ts`).
 */
router.post('/', requireMcpToken, apiTokenRateLimit(), handleMcpRequest);

// A stateless server has no stream to resume and no session to delete.
router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

export default router;
