import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/app';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { isMcpEnabled } from '@config/mcp';
import type { ApiTokenScope } from '@entity/ApiToken';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import type { Tenant } from '@entity/Tenant';
import { MCP_SCOPES } from '@middleware/api-token-policy';
import { getBearerToken } from '@middleware/auth-helpers';
import { recordUserActive } from '@service/analytics/service-events.service';
import { authenticateApiToken, isApiTokenShaped } from '@service/api-token/api-token.service';
import { revokeMcpOAuthGrant } from '@service/auth/better-auth';
import { MCP_OAUTH_READ_SCOPE, mcpOAuthResourceIfEnabled, protectedResourceMetadataUrl } from '@service/mcp/mcp-oauth-config';
import { verifyMcpOAuthAccessToken } from '@service/mcp/mcp-oauth-token.service';
import type { McpCredential } from '@service/mcp/mcp-types';
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
 * The RFC 6750 / RFC 9728 challenge for a refused MCP request, when OAuth is on: it points the
 * client at the protected resource metadata, which names the authorization server, so a client
 * that knows only the URL can start the OAuth flow. With OAuth off there is nothing to discover
 * and no header is sent.
 */
function setChallenge(res: Response, resource: null | string, error?: 'insufficient_scope' | 'invalid_token'): void {
  if (!resource) return;
  const params = [
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${protectedResourceMetadataUrl(resource)}"`,
    `scope="${MCP_OAUTH_READ_SCOPE}"`,
  ];
  res.setHeader('WWW-Authenticate', `Bearer ${params.join(', ')}`);
}

/**
 * Authenticate `POST /v1/mcp` with a personal API token, or, when `MCP_OAUTH_ENABLED` is on,
 * an OAuth access token a client obtained through the person's consent.
 *
 * This route sits outside `requireAuth` on purpose: a browser session cookie must never reach
 * the MCP server, because an MCP client is a long-lived machine credential. The accepted
 * credentials are `Authorization: Bearer wm_pat_…` carrying `mcp:read` (the read tools) or
 * `mcp:propose` (the `propose_*` tools), or both; and an OAuth access token for this resource
 * carrying `mcp:read`, which reaches the read tools only. A cookie sent alongside either is
 * ignored; a cookie sent alone gets 401.
 *
 * Either way the caller resolves to an app user and their household, and the tenant filter is
 * armed for them exactly as `resolveTenantForRequest` does for a session, so the tools see what
 * that person sees in the app: their household, without a member's private accounts they were
 * not given.
 */
export async function requireMcpToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const oauthResource = mcpOAuthResourceIfEnabled();
  const bearer = getBearerToken(req.headers.authorization);

  // Anything that is not a personal API token is read as an OAuth access token. (Asked as a plain
  // boolean: `isApiTokenShaped` is a type guard, which would narrow every other bearer away.)
  const isPersonalToken = (value: string): boolean => isApiTokenShaped(value);
  if (bearer !== null && isPersonalToken(bearer)) {
    await authenticateWithApiToken(req, res, next, bearer, oauthResource);
    return;
  }

  if (bearer && oauthResource) {
    await authenticateWithOAuth(req, res, next, bearer, oauthResource);
    return;
  }

  setChallenge(res, oauthResource);
  next(new UnauthorizedError(oauthResource
    ? 'An MCP request needs an OAuth access token or a personal API token with the mcp:read scope.'
    : 'An MCP request needs a personal API token with the mcp:read or mcp:propose scope.'));
}

async function authenticateWithApiToken(req: Request, res: Response, next: NextFunction, bearer: string, oauthResource: null | string): Promise<void> {
  let authenticated;
  try {
    authenticated = await authenticateApiToken(bearer, { ip: req.ip });
  } catch (error) {
    logger.error(`MCP token lookup failed: ${error}`);
    setChallenge(res, oauthResource, 'invalid_token');
    next(new UnauthorizedError('Invalid API token'));
    return;
  }
  if (!authenticated) {
    setChallenge(res, oauthResource, 'invalid_token');
    next(new UnauthorizedError('Invalid API token'));
    return;
  }

  const { apiToken, appuser, tenant } = authenticated;
  if (!MCP_SCOPES.some((scope) => apiToken.scopes.includes(scope))) {
    next(new ForbiddenError('This API token has neither the mcp:read nor the mcp:propose scope.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED));
    return;
  }

  req.apiToken = { apiTokenKey: apiToken.apiTokenKey, scopes: apiToken.scopes };
  await establishCaller(req, {
    appuser,
    credential: { apiTokenKey: apiToken.apiTokenKey, kind: 'api_token' },
    scopes: apiToken.scopes,
    sessionId: `api-token:${apiToken.apiTokenKey}`,
    tenant,
  });
  next();
}

async function authenticateWithOAuth(req: Request, res: Response, next: NextFunction, bearer: string, resource: string): Promise<void> {
  let verification;
  try {
    verification = await verifyMcpOAuthAccessToken(bearer, resource);
  } catch (error) {
    logger.error({ err: error }, 'MCP OAuth token check failed');
    verification = { error: 'invalid_token' as const, ok: false as const };
  }

  if (!verification.ok) {
    setChallenge(res, resource, verification.error);
    next(verification.error === 'insufficient_scope'
      ? new ForbiddenError('This access token does not carry the mcp:read scope.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED)
      : new UnauthorizedError('Invalid or revoked access token'));
    return;
  }

  // The person behind the grant, and their household, resolved the way a session resolves them:
  // the live app user and their one active membership. The consent was given for one household;
  // once the person is in another (removed, or joined elsewhere), the grant is revoked, so the
  // client never reads a household the person did not consent for.
  const { clientId, household, userId } = verification.caller;
  const appuser = await DI.em.findOne(Appuser, { deletedAt: null, externalUserId: userId, recordActive: true }, { filters: false });
  const membership = appuser ? await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(appuser) : null;
  const tenant = membership?.tenantKey;
  if (!appuser || !tenant || tenant.deletedAt || !tenant.recordActive || String(tenant.tenantKey) !== household) {
    if (appuser && tenant && String(tenant.tenantKey) !== household) {
      await revokeMcpOAuthGrant(userId, clientId).catch((error: unknown) => {
        logger.error({ err: error }, 'Revoking an MCP OAuth grant for a former household failed');
      });
    }
    setChallenge(res, resource, 'invalid_token');
    next(new UnauthorizedError('Invalid or revoked access token'));
    return;
  }

  await establishCaller(req, {
    appuser,
    credential: { clientId, kind: 'oauth', userId },
    scopes: [MCP_OAUTH_READ_SCOPE],
    sessionId: `oauth:${clientId}`,
    tenant,
  });
  next();
}

async function establishCaller(req: Request, input: {
  appuser: Appuser;
  credential: McpCredential;
  scopes: readonly ApiTokenScope[];
  sessionId: string;
  tenant: Tenant;
}): Promise<void> {
  const { appuser, credential, scopes, sessionId, tenant } = input;
  await DI.em.populate(appuser, ['currencyKey']);

  req.user = appuser;
  req.tenant = tenant;
  req.authUser = {
    session: { createdAt: new Date(0), id: sessionId },
    user: {
      email: appuser.emailAddress,
      emailVerified: true,
      id: appuser.externalUserId,
      image: null,
      name: [appuser.firstName, appuser.lastName].filter(Boolean).join(' ') || null,
      twoFactorEnabled: null,
    },
  };
  req.mcpIdentity = { appuser, credential, scopes, tenant };

  // Arm the tenant filter and its per-account privacy carve-out on the request EM, exactly as
  // `resolveTenantForRequest` does for a session.
  setTenantContext(DI.em, { appuserKey: appuser.appuserKey, tenantKey: tenant.tenantKey });
  await recordUserActive(DI.em, appuser, 'api');
}
