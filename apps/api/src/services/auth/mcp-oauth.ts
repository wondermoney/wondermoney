import { mcp } from '@better-auth/mcp';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';

import { SENSITIVE_SESSION_MAX_AGE_MS } from '@service/auth/sensitive-session-age';
import { MCP_OAUTH_ACCESS_TOKEN_SECONDS, MCP_OAUTH_HOUSEHOLD_CLAIM, MCP_OAUTH_SCOPES } from '@service/mcp/mcp-oauth-config';

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
  /** The household (tenant key) `userId` belongs to now, or null when they have none. */
  householdOf: (userId: string) => Promise<null | number>;
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
 * WonderMoney's rules around better-auth's OAuth endpoints, as before-hooks:
 *
 * - Consent is a sensitive action, like creating a personal API token: accepting needs a session
 *   under 24 hours old and, for an account with two-factor authentication, the current
 *   authenticator code in `x-totp-code` (`middleware/sensitive-session.ts` holds the same rule
 *   for the `/v1` routes). Answers 403 with `session_not_fresh`, `totp_required` or `invalid_totp`.
 * - Registration takes `https` redirects, or `http` on a loopback host, and nothing else
 *   (`isAllowedMcpRedirectUri`), and no DPoP-bound clients.
 * - An authorization request that names no `resource` is for the MCP server, the only resource
 *   here, so it gets that one: a token without the audience would be refused at `/v1/mcp`.
 * - The token endpoint refuses DPoP proofs. `/v1/mcp` checks no proof, so it accepts bearer
 *   tokens only, and a DPoP-bound token would never work there.
 */
function mcpOAuthPolicy(deps: McpOAuthPolicyDeps): BetterAuthPlugin {
  return {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            // No session: better-auth's own session middleware answers 401.
            if (!session) return;
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
          }),
          matcher: (ctx) => ctx.path === '/oauth2/consent' && (ctx.body as undefined | { accept?: unknown })?.accept === true,
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
          handler: createAuthMiddleware(async (ctx) => {
            const query = (ctx.query ?? {}) as Record<string, unknown>;
            if (query['resource'] === undefined || query['resource'] === '') {
              return Promise.resolve({ context: { query: { ...query, resource: deps.resource } } });
            }
            return Promise.resolve();
          }),
          matcher: (ctx) => ctx.path === '/oauth2/authorize' && ctx.method !== 'POST',
        },
        {
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            if (body['resource'] === undefined || body['resource'] === '') {
              return Promise.resolve({ context: { body: { ...body, resource: deps.resource } } });
            }
            return Promise.resolve();
          }),
          matcher: (ctx) => ctx.path === '/oauth2/authorize' && ctx.method === 'POST',
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
    const household = await input.householdOf(userId);
    if (household === null) refuse('FORBIDDEN', { error: 'access_denied', error_description: 'This account has no household yet.' });
    return String(household);
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
