import express from 'express';

import { getMcpAuthorizationServerMetadata, getMcpProtectedResourceMetadata } from '@controller/mcp';

/**
 * The OAuth discovery documents for the MCP server, mounted at `/.well-known` (the API's root,
 * not `/v1`): RFC 9728 protected resource metadata and RFC 8414 authorization server metadata.
 * Both answer 404 unless `MCP_OAUTH_ENABLED` is on. Public: an MCP client reads them before it
 * has any credential.
 */
const router = express.Router();

router.get(['/oauth-protected-resource', '/oauth-protected-resource/v1/mcp'], getMcpProtectedResourceMetadata);
router.get(['/oauth-authorization-server', '/oauth-authorization-server/*splat'], getMcpAuthorizationServerMetadata);

export default router;
