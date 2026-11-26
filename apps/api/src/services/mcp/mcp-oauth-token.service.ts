import { verifyJwsAccessToken } from 'better-auth/oauth2';

import { findMcpOAuthGrant, getMcpOAuthIssuer, getMcpOAuthJwks } from '@service/auth/better-auth';

import { MCP_OAUTH_HOUSEHOLD_CLAIM, MCP_OAUTH_READ_SCOPE } from './mcp-oauth-config';

/** A verified OAuth access token: whose it is, which client holds it, and what it may do. */
export interface McpOAuthCaller {
  clientId: string;
  /** The household (tenant key) the person consented for, as the token carries it. */
  household: string;
  scopes: string[];
  userId: string;
}

export type McpOAuthVerification =
  | { caller: McpOAuthCaller; ok: true }
  /** `invalid_token` answers 401 (sign in again); `insufficient_scope` answers 403. */
  | { error: 'insufficient_scope' | 'invalid_token'; ok: false };

// The key set is read in-process from better-auth and cached by the verifier under this key, with
// the same lifetime and unknown-key refetch as a fetched JWKS.
const JWKS_CACHE_KEY = {};

/**
 * Verify an OAuth access token presented to `POST /v1/mcp`.
 *
 * The token must be one this server issued for the MCP resource: a JWT signed with the JWT
 * plugin's keys, of type `at+jwt`, from this issuer, with `resource` as its audience and not
 * expired. A session JWT (`/api/auth/token`, audience the API itself) or a token for any other
 * resource fails here. A sender-constrained (DPoP) token is refused: this endpoint checks no
 * proof, so it accepts bearer tokens only.
 *
 * Then the grant behind it must still stand: the person's consent to this client for the
 * household the token names, given no later than the token was issued, on a client that is not
 * disabled; and, for a token issued with a refresh token, that refresh token not revoked (a
 * replayed authorization code or a torn-down refresh family takes its access tokens with it).
 * Revoking the client in Settings deletes the consent, so every token it holds is refused from
 * the next call, and re-connecting later does not bring an older token back. Both the token and
 * the consent must carry `mcp:read`. Whether the person is still in that household is the
 * caller's to check (`middleware/mcp-auth.ts`).
 */
export async function verifyMcpOAuthAccessToken(token: string, resource: string): Promise<McpOAuthVerification> {
  let payload: Awaited<ReturnType<typeof verifyJwsAccessToken>>;
  try {
    payload = await verifyJwsAccessToken(token, {
      jwksCacheKey: JWKS_CACHE_KEY,
      jwksFetch: getMcpOAuthJwks,
      verifyOptions: {
        audience: resource,
        issuer: await getMcpOAuthIssuer(),
        requiredClaims: ['azp', 'exp', 'iat', 'sub'],
        typ: 'at+jwt',
      },
    });
  } catch {
    return { error: 'invalid_token', ok: false };
  }

  if (payload['cnf'] !== undefined) return { error: 'invalid_token', ok: false };
  const userId = payload.sub;
  const clientId = payload['azp'];
  const issuedAt = payload.iat;
  const household = payload[MCP_OAUTH_HOUSEHOLD_CLAIM];
  if (typeof userId !== 'string' || !userId || typeof clientId !== 'string' || !clientId || typeof issuedAt !== 'number' || typeof household !== 'string' || !household) {
    return { error: 'invalid_token', ok: false };
  }
  const scopes = typeof payload['scope'] === 'string' ? payload['scope'].split(' ').filter(Boolean) : [];

  const grant = await findMcpOAuthGrant(userId, clientId, { household, issuedAt, withRefreshToken: scopes.includes('offline_access') });
  if (!grant || grant.consentedAt.getTime() > issuedAt * 1000 || grant.refreshTokenLive === false) return { error: 'invalid_token', ok: false };

  if (!scopes.includes(MCP_OAUTH_READ_SCOPE) || !grant.scopes.includes(MCP_OAUTH_READ_SCOPE)) {
    return { error: 'insufficient_scope', ok: false };
  }
  return { caller: { clientId, household, scopes, userId }, ok: true };
}
