import api from "@/lib/api/api";

/**
 * The OAuth consent step for the MCP server (`MCP_OAUTH_ENABLED`): an MCP client such as ChatGPT
 * sends the person to the API's authorization endpoint, which sends them here with the request
 * it signed (`client_id`, `scope`, `redirect_uri`, … and `sig`). Accepting posts that query back
 * to better-auth's `/oauth2/consent`, which answers with the client's redirect, carrying the
 * authorization code; declining answers with the client's redirect carrying `access_denied`.
 */

/** What the consent page reads off the signed authorization request. */
export interface OAuthConsentRequest {
  clientId: string;
  /** The host the client gets the code back on (`chatgpt.com`): a self-declared name is not proof. */
  redirectHost: null | string;
  scopes: string[];
  /** The whole query, exactly as received: better-auth checks its signature. */
  oauthQuery: string;
}

/** The scopes this server grants, in the order the consent page lists them. */
export const OAUTH_CONSENT_SCOPES = ["mcp:read", "offline_access"] as const;
export type OAuthConsentScope = (typeof OAUTH_CONSENT_SCOPES)[number];

export function isKnownConsentScope(scope: string): scope is OAuthConsentScope {
  return (OAUTH_CONSENT_SCOPES as readonly string[]).includes(scope);
}

/** Read the consent request off the page's query, or null when it is not one. */
export function parseOAuthConsentRequest(
  search: string,
): OAuthConsentRequest | null {
  const oauthQuery = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get("client_id");
  if (!clientId || !params.get("sig")) return null;
  let redirectHost: null | string = null;
  try {
    redirectHost = new URL(params.get("redirect_uri") ?? "").host || null;
  } catch {
    redirectHost = null;
  }
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
  return { clientId, oauthQuery, redirectHost, scopes };
}

/** The client's public fields, as it registered them. */
export interface OAuthClientInfo {
  client_id: string;
  client_name?: null | string;
  client_uri?: null | string;
  logo_uri?: null | string;
}

export async function getOAuthClientInfo(
  clientId: string,
): Promise<OAuthClientInfo> {
  const { data } = await api.get<OAuthClientInfo>(
    "/api/auth/oauth2/public-client",
    {
      params: { client_id: clientId },
    },
  );
  return data;
}

/** Accept or decline: the URL to send the browser to next (the client's redirect). */
export async function submitOAuthConsent(input: {
  accept: boolean;
  oauthQuery: string;
}): Promise<string> {
  const { data } = await api.post<{ redirect: boolean; url: string }>(
    "/api/auth/oauth2/consent",
    { accept: input.accept, oauth_query: input.oauthQuery },
  );
  return data.url;
}
