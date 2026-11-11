import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/app';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { isMcpEnabled } from '@config/mcp';
import { getBearerToken } from '@middleware/auth-helpers';
import { authenticateApiToken, isApiTokenShaped } from '@service/api-token/api-token.service';
import { ERROR_CODE, ForbiddenError, NotFoundError, UnauthorizedError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * `MCP_ENABLED=false` hides the endpoint entirely: a 404, not a 403, so an instance that does
 * not offer MCP looks like one that never had it.
 */
export function requireMcpEnabled(_req: Request, _res: Response, next: NextFunction): void {
  if (!isMcpEnabled()) {
    next(new NotFoundError());
    return;
  }
  next();
}

/**
 * Authenticate `POST /v1/mcp` with a personal API token only.
 *
 * This route sits outside `requireAuth` on purpose: a browser session cookie must never reach
 * the MCP server, because an MCP client is a long-lived machine credential. The only accepted
 * credential is `Authorization: Bearer wm_pat_…` carrying the `mcp:read` scope. A cookie sent
 * alongside it is ignored; a cookie sent alone gets 401.
 */
export async function requireMcpToken(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const bearer = getBearerToken(req.headers.authorization);
  if (!isApiTokenShaped(bearer)) {
    next(new UnauthorizedError('An MCP request needs a personal API token with the mcp:read scope.'));
    return;
  }

  let authenticated;
  try {
    authenticated = await authenticateApiToken(bearer, { ip: req.ip });
  } catch (error) {
    logger.error(`MCP token lookup failed: ${error}`);
    next(new UnauthorizedError('Invalid API token'));
    return;
  }
  if (!authenticated) {
    next(new UnauthorizedError('Invalid API token'));
    return;
  }

  const { apiToken, appuser, tenant } = authenticated;
  if (!apiToken.scopes.includes('mcp:read')) {
    next(new ForbiddenError('This API token does not have the mcp:read scope.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED));
    return;
  }

  await DI.em.populate(appuser, ['currencyKey']);

  req.apiToken = { apiTokenKey: apiToken.apiTokenKey, scopes: apiToken.scopes };
  req.user = appuser;
  req.tenant = tenant;
  req.authUser = {
    session: { createdAt: new Date(0), id: `api-token:${apiToken.apiTokenKey}` },
    user: {
      email: appuser.emailAddress,
      emailVerified: true,
      id: appuser.externalUserId,
      image: null,
      name: [appuser.firstName, appuser.lastName].filter(Boolean).join(' ') || null,
      twoFactorEnabled: null,
    },
  };
  req.mcpIdentity = { apiTokenKey: apiToken.apiTokenKey, appuser, tenant };

  // Arm the tenant filter and its per-account privacy carve-out on the request EM, exactly as
  // `resolveTenantForRequest` does for a session.
  setTenantContext(DI.em, { appuserKey: appuser.appuserKey, tenantKey: tenant.tenantKey });
  next();
}
