import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/app';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { isMcpEnabled } from '@config/mcp';
import { ApiToken, type ApiTokenScope } from '@entity/ApiToken';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import type { Tenant } from '@entity/Tenant';
import { MCP_SCOPES } from '@middleware/api-token-policy';
import { getBearerToken } from '@middleware/auth-helpers';
import { type AuthFailureBudget, createAuthFailureLimiter } from '@middleware/rate-limit';
import { recordUserActive } from '@service/analytics/service-events.service';
import { authenticateApiToken, hashApiToken, isApiTokenShaped } from '@service/api-token/api-token.service';
import { mcpOAuthHouseholdReference, revokeMcpOAuthGrant } from '@service/auth/better-auth';
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
  // While OAuth is on, a request with a bearer skips the per-IP backstop
  // (`isSharedEgressRequest`), so its failures are budgeted per address here; the count is read
  // now, before anything is looked up. Off, the backstop applies as it always has.
  const hasBearerHeader = /^bearer\s+\S/i.test(req.get('authorization') ?? '');
  const budget = oauthResource && hasBearerHeader ? await mcpAuthFailures.check(req) : null;
  const outcome = createOutcome(res, next, budget);

  // Anything that is not a personal API token is read as an OAuth access token. (Asked as a plain
  // boolean: `isApiTokenShaped` is a type guard, which would narrow every other bearer away.)
  const isPersonalToken = (value: string): boolean => isApiTokenShaped(value);
  if (bearer !== null && isPersonalToken(bearer)) {
    // Over budget, a personal-token-shaped bearer is turned away before its database lookup.
    if (budget?.overBudget) {
      budget.refuse(res);
      return;
    }
    await authenticateWithApiToken(req, res, outcome, bearer, oauthResource);
    return;
  }

  if (bearer && oauthResource) {
    await authenticateWithOAuth(req, res, outcome, bearer, oauthResource);
    return;
  }

  setChallenge(res, oauthResource);
  await outcome.rejected(bearer !== null, new UnauthorizedError(oauthResource
    ? 'An MCP request needs an OAuth access token or a personal API token with the mcp:read scope.'
    : 'An MCP request needs a personal API token with the mcp:read or mcp:propose scope.'));
}

/**
 * Failed bearer checks on `/v1/mcp` while OAuth is on, per address (`mcpAuthFailure`, 300 per
 * quarter hour): forged OAuth tokens and unknown personal tokens.
 */
const mcpAuthFailures = createAuthFailureLimiter('mcpAuthFailure');

/** Exported for tests: drops the failure counts. */
export function resetMcpAuthFailures(): Promise<void> {
  return mcpAuthFailures.reset();
}

/** How one check ends: the credential was valid (whatever it may reach), or it was not. */
interface McpAuthOutcome {
  /** Valid credential, refused for what it carries (a missing scope). */
  forbidden: (error: Error) => void;
  /** Valid credential: on to the server. */
  passed: () => void;
  /**
   * Refused credential. `counted` when it is a failed authentication (`mcpAuthFailure`): a forged
   * token or an unknown personal token, which answers 429 instead of 401 past the budget. A
   * genuine token that is expired, for another audience or revoked is not counted.
   */
  rejected: (counted: boolean, error: Error) => Promise<void>;
}

async function authenticateWithApiToken(req: Request, res: Response, outcome: McpAuthOutcome, bearer: string, oauthResource: null | string): Promise<void> {
  let authenticated;
  try {
    authenticated = await authenticateApiToken(bearer, { ip: req.ip });
  } catch (error) {
    logger.error(`MCP token lookup failed: ${error}`);
    setChallenge(res, oauthResource, 'invalid_token');
    await outcome.rejected(false, new UnauthorizedError('Invalid API token'));
    return;
  }
  if (!authenticated) {
    setChallenge(res, oauthResource, 'invalid_token');
    // Only a token that was never issued counts; an expired or revoked one is genuine. Asked only
    // when there is a budget to count against (OAuth on).
    const unknown = oauthResource ? !await isIssuedApiToken(bearer) : false;
    await outcome.rejected(unknown, new UnauthorizedError('Invalid API token'));
    return;
  }

  const { apiToken, appuser, tenant } = authenticated;
  if (!MCP_SCOPES.some((scope) => apiToken.scopes.includes(scope))) {
    outcome.forbidden(new ForbiddenError('This API token has neither the mcp:read nor the mcp:propose scope.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED));
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
  outcome.passed();
}

async function authenticateWithOAuth(req: Request, res: Response, outcome: McpAuthOutcome, bearer: string, resource: string): Promise<void> {
  let verification;
  try {
    verification = await verifyMcpOAuthAccessToken(bearer, resource);
  } catch (error) {
    logger.error({ err: error }, 'MCP OAuth token check failed');
    verification = { error: 'invalid_token' as const, forged: false, ok: false as const };
  }

  if (!verification.ok) {
    setChallenge(res, resource, verification.error);
    if (verification.error === 'insufficient_scope') {
      outcome.forbidden(new ForbiddenError('This access token does not carry the mcp:read scope.', ERROR_CODE.API_TOKEN_SCOPE_REQUIRED));
    } else {
      await outcome.rejected(verification.forged, new UnauthorizedError('Invalid or revoked access token'));
    }
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
  const sameHousehold = tenant ? mcpOAuthHouseholdReference(tenant.tenantKey) === household : false;
  if (!appuser || !tenant || tenant.deletedAt || !tenant.recordActive || !sameHousehold) {
    if (appuser && tenant && !sameHousehold) {
      await revokeMcpOAuthGrant(userId, clientId).catch((error: unknown) => {
        logger.error({ err: error }, 'Revoking an MCP OAuth grant for a former household failed');
      });
    }
    setChallenge(res, resource, 'invalid_token');
    await outcome.rejected(false, new UnauthorizedError('Invalid or revoked access token'));
    return;
  }

  await establishCaller(req, {
    appuser,
    credential: { clientId, kind: 'oauth', userId },
    scopes: [MCP_OAUTH_READ_SCOPE],
    sessionId: `oauth:${clientId}`,
    tenant,
  });
  outcome.passed();
}

function createOutcome(res: Response, next: NextFunction, budget: AuthFailureBudget | null): McpAuthOutcome {
  return {
    forbidden: (error) => { next(error); },
    passed: () => { next(); },
    rejected: async (counted, error) => {
      if (counted && budget && await budget.failed(res)) return;
      next(error);
    },
  };
}

/** Whether a personal-token-shaped bearer was ever issued here, live or not. */
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

async function isIssuedApiToken(token: string): Promise<boolean> {
  return (await DI.em.count(ApiToken, { secretHash: hashApiToken(token) }, { filters: false })) > 0;
}
