import { mcp } from '@better-auth/mcp';

import { MCP_OAUTH_ACCESS_TOKEN_SECONDS, MCP_OAUTH_SCOPES } from '@service/mcp/mcp-oauth-config';

/**
 * OAuth for the MCP server: better-auth's `@better-auth/mcp` plugin, which is its OAuth 2.1
 * provider (`@better-auth/oauth-provider`) set up for MCP clients. It makes the API an
 * authorization server for exactly one protected resource, `<API_URL>/v1/mcp`, so that a client
 * that knows only that URL (ChatGPT, Claude) can register, send the person through sign-in and
 * consent, and call the read tools. Installed only when `MCP_OAUTH_ENABLED` is on
 * (`services/mcp/mcp-oauth-config.ts`).
 *
 * The policy, beyond the plugin's defaults:
 * - Dynamic client registration (RFC 7591) without authentication, as MCP clients expect. A
 *   registered client gets nothing by itself: every grant needs the person's consent.
 * - Authorization code with PKCE (S256) only, plus refresh tokens, which rotate on every use.
 *   No client credentials grant, so no token without a person behind it.
 * - Scopes `mcp:read` and `offline_access`; no OpenID scopes, so the client learns nothing about
 *   the person beyond what the tools return.
 * - Access tokens are JWTs bound to the MCP resource (`aud`), valid for 15 minutes.
 *   `middleware/mcp-auth.ts` checks each one against the consent on every call, so revoking a
 *   client in Settings stops it at once.
 * - No session-backed client management (create, update, rotate, delete through better-auth's
 *   client routes) and no resource administration over HTTP: `clientPrivileges` and
 *   `resourcePrivileges` refuse every action.
 * - Sign-in and consent both land on the web app's consent page, which sends a signed-out
 *   visitor through the ordinary sign-in first (any method: password, passkey, Google, OIDC,
 *   with the second factor) and comes back to ask for consent.
 */
export function mcpOAuthPlugin(input: { appUrl: string; resource: string }) {
  const consentPage = new URL('oauth/consent', input.appUrl.endsWith('/') ? input.appUrl : `${input.appUrl}/`).toString();
  const scopes = [...MCP_OAUTH_SCOPES];
  return mcp({
    accessTokenExpiresIn: MCP_OAUTH_ACCESS_TOKEN_SECONDS,
    advertisedMetadata: { scopes_supported: scopes },
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientPrivileges: () => false,
    clientRegistrationDefaultApplicationType: 'infer',
    clientRegistrationDefaultScopes: scopes,
    consentPage,
    grantTypes: ['authorization_code', 'refresh_token'],
    loginPage: consentPage,
    prefix: { clientSecret: 'wm_oauth_cs_', refreshToken: 'wm_oauth_rt_' },
    resource: input.resource,
    resourcePrivileges: () => false,
    scopes,
  });
}
