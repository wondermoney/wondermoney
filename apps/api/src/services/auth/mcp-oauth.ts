import { defineRequestState } from '@better-auth/core/context';
import { mcp } from '@better-auth/mcp';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';

import { SENSITIVE_SESSION_MAX_AGE_MS } from '@service/auth/sensitive-session-age';
import { MCP_OAUTH_ACCESS_TOKEN_SECONDS, MCP_OAUTH_HOUSEHOLD_CLAIM, MCP_OAUTH_SCOPES } from '@service/mcp/mcp-oauth-config';
import logger from '@utils/logger';

/**
 * Request budgets for the two OAuth endpoints clients call without a person in the browser, per
 * client address and minute (better-auth's own limiter, which keys on the address and the path).
 * Sized for a hosted server where many people's ChatGPT sessions arrive from the same few
 * OpenAI addresses: a token refresh every quarter hour per person, and one registration per
 * connection. better-auth applies them in production only.
 */
export const MCP_OAUTH_RATE_LIMITS = {
  register: { max: 60, window: 60 },
  token: { max: 300, window: 60 },
} as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * Whether a client may register `uri` as a redirect: `https` with a host, or plain `http` on a
 * loopback host (a native client's local callback, RFC 8252 §7.3). Private-use schemes
 * (`myapp://callback`) are refused outright: nothing that connects here needs one, and one can
 * name any host (`evilapp://chatgpt.com/…`), so the consent page could not say honestly where
 * the person's answer goes.
 */
interface McpOAuthPolicyDeps {
  /** Someone consented to `clientId`: it no longer counts as disconnected (`clearMcpOAuthClientGrantEnd`). */
  clearGrantEnd: (clientId: string) => Promise<void>;
  /** The opaque reference of the household `userId` belongs to now, or null when they have none. */
  householdReferenceOf: (userId: string) => Promise<null | string>;
  /** Whether `clientId` is registered, waiting for a removal under way (`isMcpOAuthClientRegistered`). */
  isClientRegistered: (clientId: string) => Promise<boolean>;
  /** The MCP resource identifier, defaulted onto an authorization request that names none. */
  resource: string;
  /** Throws unless `code` is the signed-in person's current TOTP code. */
  verifyTotp: (headers: Headers, code: string) => Promise<void>;
}

export function isAllowedMcpRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || uri.includes('#')) return false;
  if (url.protocol === 'https:') return url.hostname.length > 0;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

function refuse(status: 'BAD_REQUEST' | 'FORBIDDEN', body: Record<string, string>): never {
  throw new APIError(status, body);
}

/**
 * Set, within one request, once the consent hook has passed (fresh session, TOTP): only the
 * authorization that consent dispatches may then issue a code. Every other authorization
 * request, including one with a consent already stored, is sent to the consent page.
 */
const consentApproved = defineRequestState(() => false);

/** The client an accepted consent is for, as the signed authorization request names it. */
function consentClientId(body: unknown): null | string {
  const query = (body as undefined | { oauth_query?: unknown })?.oauth_query;
  return typeof query === 'string' ? new URLSearchParams(query).get('client_id') || null : null;
}

const isAcceptedConsent = (ctx: { body?: unknown; path?: string }) =>
  ctx.path === '/oauth2/consent' && (ctx.body as undefined | { accept?: unknown })?.accept === true;

const CONSENT_MANAGEMENT_PATHS: ReadonlySet<string> = new Set(['/oauth2/delete-consent', '/oauth2/get-consent', '/oauth2/get-consents', '/oauth2/update-consent']);

/** Whether `requested` is one of `registered`, a loopback one up to its port (RFC 8252 §7.3). */
function isRegisteredRedirect(registered: unknown, requested: string): boolean {
  const uris = Array.isArray(registered) ? registered.filter((uri): uri is string => typeof uri === 'string') : [];
  const withoutLoopbackPort = (uri: string) => {
    try {
      const url = new URL(uri);
      if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) url.port = '';
      return url.toString();
    } catch {
      return uri;
    }
  };
  return uris.some((uri) => uri === requested || withoutLoopbackPort(uri) === withoutLoopbackPort(requested));
}

/**
 * `prompt=none` asks for a code without showing the person anything, which consent here never
 * allows. A request from a known client to one of its own redirects gets `consent_required`
 * there (the RFC 6749 authorization error response, with `iss`, RFC 9207); anything else falls through to better-auth,
 * which refuses an unknown client or redirect on its own error page.
 */
async function refuseSilentAuthorization(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0], params: Record<string, unknown>): Promise<void> {
  const clientId = typeof params['client_id'] === 'string' ? params['client_id'] : '';
  const redirectUri = typeof params['redirect_uri'] === 'string' ? params['redirect_uri'] : '';
  if (!clientId || !redirectUri) return;
  const client = await ctx.context.adapter.findOne<{ disabled?: boolean | null; redirectUris?: unknown }>({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  });
  if (!client || client.disabled || !isRegisteredRedirect(client.redirectUris, redirectUri)) return;
  const target = new URL(redirectUri);
  target.searchParams.set('error', 'consent_required');
  target.searchParams.set('error_description', 'End-User consent is required');
  if (typeof params['state'] === 'string') target.searchParams.set('state', params['state']);
  target.searchParams.set('iss', ctx.context.baseURL.replace(/\/+$/, ''));
  throw ctx.redirect(target.toString());
}

/**
 * WonderMoney's rules around better-auth's OAuth endpoints, as before-hooks:
 *
 * - Consent is a sensitive action, like creating a personal API token: accepting needs a session
 *   under 24 hours old and, for an account with two-factor authentication, the current
 *   authenticator code in `x-totp-code` (`middleware/sensitive-session.ts` holds the same rule
 *   for the `/v1` routes). Answers 403 with `session_not_fresh`, `totp_required` or `invalid_totp`,
 *   and 400 `invalid_client` for a client that is no longer registered (the daily prune removed
 *   it while the consent page was open, or is removing it now). A stored consent clears the
 *   client's disconnection time (`mcpOAuthClientActivity`).
 * - Registration takes `https` redirects, or `http` on a loopback host, and nothing else
 *   (`isAllowedMcpRedirectUri`), and no DPoP-bound clients.
 * - Every authorization request shows the consent page (`prompt=consent` is added, and
 *   `prompt=none` answers `consent_required`), even for a client the person allowed before: a
 *   stored consent never issues a code on its own, so the freshness and TOTP check above runs
 *   for every code. This covers authorizations better-auth dispatches itself, after a sign-in or
 *   from `/oauth2/continue`, as they pass through the same hook.
 * - An authorization request that names no `resource` is for the MCP server, the only resource
 *   here, so it gets that one: a token without the audience would be refused at `/v1/mcp`.
 * - A refresh may not drop `offline_access`, so the refresh-family check applies to every token.
 * - better-auth's consent read and edit routes answer 403: grants are listed and revoked in
 *   Settings (`/v1/user/mcp-clients`).
 * - The token endpoint refuses DPoP proofs. `/v1/mcp` checks no proof, so it accepts bearer
 *   tokens only, and a DPoP-bound token would never work there.
 */
function mcpOAuthPolicy(deps: McpOAuthPolicyDeps): BetterAuthPlugin {
  return {
    hooks: {
      after: [
        {
          // A stored consent is a grant again: the client is no longer disconnected.
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            if (returned instanceof Error || (returned instanceof Response && !returned.ok)) return;
            const clientId = consentClientId(ctx.body);
            // Bookkeeping only: the consent stands either way, and a stale time only lets the
            // prune count from an earlier disconnection, which it cannot act on while this consent lasts.
            if (clientId) {
              await deps.clearGrantEnd(clientId).catch((error: unknown) => {
                logger.warn({ err: error }, 'Clearing an MCP OAuth client\'s disconnection time failed');
              });
            }
          }),
          matcher: isAcceptedConsent,
        },
      ],
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            // No session: better-auth's own session middleware answers 401.
            if (!session) return;
            // A client removed since the consent page opened (the daily prune), or being removed
            // now: better-auth would fail storing the consent with a server error.
            const clientId = consentClientId(ctx.body);
            if (clientId && !await deps.isClientRegistered(clientId)) {
              refuse('BAD_REQUEST', { error: 'invalid_client', error_description: 'This client is no longer registered. Add it again in the app you are connecting.' });
            }
            const createdAt = new Date(session.session.createdAt).getTime();
            if (!Number.isFinite(createdAt) || Date.now() - createdAt > SENSITIVE_SESSION_MAX_AGE_MS) {
              refuse('FORBIDDEN', { code: 'session_not_fresh', message: 'Please sign in again before connecting a client.' });
            }
            if ((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) {
              const code = ctx.headers?.get('x-totp-code')?.trim();
              if (!code) refuse('FORBIDDEN', { code: 'totp_required', message: 'Enter your authenticator code to continue.' });
              try {
                await deps.verifyTotp(ctx.headers ?? new Headers(), code);
              } catch {
                refuse('FORBIDDEN', { code: 'invalid_totp', message: 'That authenticator code is not valid.' });
              }
            }
            // The one way to a code: the authorization this consent dispatches may issue it.
            await consentApproved.set(true);
          }),
          matcher: isAcceptedConsent,
        },
        {
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { dpop_bound_access_tokens?: unknown; post_logout_redirect_uris?: unknown; redirect_uris?: unknown };
            const redirects = [
              ...(Array.isArray(body.redirect_uris) ? body.redirect_uris : [body.redirect_uris]),
              ...(Array.isArray(body.post_logout_redirect_uris) ? body.post_logout_redirect_uris : []),
            ];
            if (!redirects.every(isAllowedMcpRedirectUri)) {
              refuse('BAD_REQUEST', {
                error: 'invalid_redirect_uri',
                error_description: 'Redirect URIs must use https, or http on 127.0.0.1 or localhost.',
              });
            }
            if (body.dpop_bound_access_tokens === true) {
              refuse('BAD_REQUEST', { error: 'invalid_client_metadata', error_description: 'DPoP-bound access tokens are not supported.' });
            }
            return Promise.resolve();
          }),
          matcher: (ctx) => ctx.path === '/oauth2/register',
        },
        {
          // An authorization request, from a client (GET query or POST form) or dispatched inside
          // better-auth (after a sign-in or `/oauth2/continue`), never issues a code by itself.
          handler: createAuthMiddleware(async (ctx) => {
            const fromBody = ctx.method === 'POST' && (ctx as { authorizeSettings?: unknown }).authorizeSettings === undefined;
            const params = ((fromBody ? ctx.body : ctx.query) ?? {}) as Record<string, unknown>;
            const resource = params['resource'] === undefined || params['resource'] === '' ? { resource: deps.resource } : {};
            if (await consentApproved.get()) {
              return { context: fromBody ? { body: { ...params, ...resource } } : { query: { ...params, ...resource } } };
            }
            const prompts = new Set(typeof params['prompt'] === 'string' ? params['prompt'].split(' ').filter(Boolean) : []);
            if (prompts.has('none')) await refuseSilentAuthorization(ctx, params);
            prompts.add('consent');
            const forced = { ...params, ...resource, prompt: [...prompts].join(' ') };
            return { context: fromBody ? { body: forced } : { query: forced } };
          }),
          matcher: (ctx) => ctx.path === '/oauth2/authorize',
        },
        {
          // Consent is given once per authorization, on the consent page; better-auth's own consent
          // routes would let a session read or change grants behind `revokeMcpOAuthGrant`.
          handler: createAuthMiddleware(() => Promise.reject(new APIError('FORBIDDEN', { error: 'access_denied', error_description: 'Manage connected clients in Settings.' }))),
          matcher: (ctx) => CONSENT_MANAGEMENT_PATHS.has(ctx.path ?? ''),
        },
        {
          // A refresh may not narrow away `offline_access`: every access token from a grant with a
          // refresh family must carry it, so `/v1/mcp` checks that family for each of them.
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { grant_type?: unknown; scope?: unknown };
            if (body.grant_type === 'refresh_token' && typeof body.scope === 'string' && !body.scope.split(' ').includes('offline_access')) {
              refuse('BAD_REQUEST', { error: 'invalid_scope', error_description: 'A refresh must keep the offline_access scope.' });
            }
            return Promise.resolve();
          }),
          matcher: (ctx) => ctx.path === '/oauth2/token',
        },
        {
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.headers?.get('dpop') || /^dpop\s/i.test(ctx.headers?.get('authorization') ?? '')) {
              refuse('BAD_REQUEST', { error: 'invalid_dpop_proof', error_description: 'DPoP is not supported by this server.' });
            }
            return Promise.resolve();
          }),
          matcher: (ctx) => ctx.path === '/oauth2/token',
        },
      ],
    },
    id: 'wondermoney-mcp-oauth-policy',
  };
}

/**
 * OAuth for the MCP server: better-auth's `@better-auth/mcp` plugin, which is its OAuth 2.1
 * provider (`@better-auth/oauth-provider`) set up for MCP clients, plus WonderMoney's policy
 * hooks (`mcpOAuthPolicy`). It makes the API an authorization server for exactly one protected
 * resource, `<API_URL>/v1/mcp`, so that a client that knows only that URL (ChatGPT, Claude) can
 * register, send the person through sign-in and consent, and call the read tools. Installed
 * only when `MCP_OAUTH_ENABLED` is on (`services/mcp/mcp-oauth-config.ts`).
 *
 * The policy, beyond the plugin's defaults:
 * - Dynamic client registration (RFC 7591) without authentication, as MCP clients expect, with
 *   `https` or loopback redirects only. A registered client gets nothing by itself: every grant
 *   needs the person's consent, given from a fresh session (and TOTP).
 * - Authorization code with PKCE (S256) only, plus refresh tokens, which rotate on every use.
 *   The MCP preset keeps a 30-second overlap in which a retried refresh gets the same response
 *   again (`refreshTokenReuseInterval`), because ChatGPT can send two refreshes at once; past it,
 *   reusing a rotated refresh token is a replay. No client credentials grant.
 * - Scopes `mcp:read` and `offline_access`; no OpenID scopes, so the client learns nothing about
 *   the person beyond what the tools return.
 * - Access tokens are JWTs bound to the MCP resource (`aud`), valid for 15 minutes, carrying the
 *   household the person consented for (`MCP_OAUTH_HOUSEHOLD_CLAIM`; the consent records it as
 *   its reference). `middleware/mcp-auth.ts` checks each one against the consent, its refresh
 *   tokens and the person's current household on every call, so revoking stops it at once.
 * - No session-backed client management (create, update, rotate, delete through better-auth's
 *   client routes) and no resource administration over HTTP: `clientPrivileges` and
 *   `resourcePrivileges` refuse every action.
 * - Sign-in and consent both land on the web app's consent page, which sends a signed-out
 *   visitor through the ordinary sign-in first (any method: password, passkey, Google, OIDC,
 *   with the second factor) and comes back to ask for consent.
 */
export function mcpOAuthPlugins(input: McpOAuthPolicyDeps & { appUrl: string }): BetterAuthPlugin[] {
  const consentPage = new URL('oauth/consent', input.appUrl.endsWith('/') ? input.appUrl : `${input.appUrl}/`).toString();
  const scopes = [...MCP_OAUTH_SCOPES];
  const householdReference = async (userId: string): Promise<string> => {
    const household = await input.householdReferenceOf(userId);
    if (household === null) refuse('FORBIDDEN', { error: 'access_denied', error_description: 'This account has no household yet.' });
    return household;
  };
  return [
    mcp({
      accessTokenExpiresIn: MCP_OAUTH_ACCESS_TOKEN_SECONDS,
      advertisedMetadata: { scopes_supported: scopes },
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientPrivileges: () => false,
      clientRegistrationDefaultApplicationType: 'infer',
      clientRegistrationDefaultScopes: scopes,
      consentPage,
      // The household the consent was given for, carried by every token from it.
      customAccessTokenClaims: ({ referenceId }) => (referenceId ? { [MCP_OAUTH_HOUSEHOLD_CLAIM]: referenceId } : {}),
      grantTypes: ['authorization_code', 'refresh_token'],
      loginPage: consentPage,
      // Never a page of its own: only here so that each consent is stored for, and its tokens
      // carry, the household the person is in when they give it.
      postLogin: {
        consentReferenceId: ({ user }) => householdReference(user.id),
        page: consentPage,
        shouldRedirect: () => false,
      },
      prefix: { clientSecret: 'wm_oauth_cs_', refreshToken: 'wm_oauth_rt_' },
      rateLimit: MCP_OAUTH_RATE_LIMITS,
      resource: input.resource,
      resourcePrivileges: () => false,
      scopes,
    }),
    mcpOAuthPolicy(input),
  ];
}

/**
 * Take back every OAuth grant a person gave when they secure their account: on a password
 * change and on signing out of other devices or everywhere (better-auth's `/change-password`,
 * `/revoke-other-sessions`, `/revoke-sessions`). A password reset does the same through
 * `emailAndPassword.onPasswordReset`. Installed whether or not OAuth is on, so a grant from
 * before the switch went off does not survive a password change made while it was off.
 */
export function mcpOAuthRevocationPlugin(input: { revokeAll: (userId: string) => Promise<void> }): BetterAuthPlugin {
  return {
    hooks: {
      after: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            if (returned instanceof Error || (returned instanceof Response && !returned.ok)) return;
            const userId = ctx.context.session?.user.id;
            if (userId) await input.revokeAll(userId);
          }),
          matcher: (ctx) => ctx.path === '/change-password' || ctx.path === '/revoke-sessions' || ctx.path === '/revoke-other-sessions',
        },
      ],
    },
    id: 'wondermoney-mcp-oauth-revocation',
  };
}
