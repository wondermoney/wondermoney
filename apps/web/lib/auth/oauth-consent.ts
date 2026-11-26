import api from "@/lib/api/api";

/**
 * The OAuth consent step for the MCP server (`MCP_OAUTH_ENABLED`): an MCP client such as ChatGPT
 * sends the person to the API's authorization endpoint, which sends them here with the request
 * it signed (`client_id`, `scope`, `redirect_uri`, … and `sig`). Accepting posts that query back
 * to better-auth's `/oauth2/consent`, which answers with the client's redirect, carrying the
 * authorization code; declining answers with the client's redirect carrying `access_denied`.
 */

/**
 * Where a client gets the person's answer back, as the consent page and Settings show it. A
 * client's name is self-declared, so this is the one thing that says where the answer goes:
 * - `web`: an `https` origin with its scheme (`https://chatgpt.com`);
 * - `device`: anything else, an app on this device, named by its loopback origin
 *   (`http://127.0.0.1:8976`) or its scheme (`evilapp:`), never by a host it might borrow
 *   (`evilapp://chatgpt.com/...` names no website).
 */
export type OAuthRedirectTarget =
  { kind: "device"; label: string } | { kind: "web"; origin: string };

export function describeRedirect(uri: string): null | OAuthRedirectTarget {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol === "https:" && url.host) {
    return { kind: "web", origin: `https://${url.host}` };
  }
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
    return { kind: "device", label: `http://${url.host}` };
  }
  return { kind: "device", label: url.protocol };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** What the consent page reads off the signed authorization request. */
export interface OAuthConsentRequest {
  clientId: string;
  /** Where the client gets the answer back; null when the request names no usable redirect. */
  redirect: null | OAuthRedirectTarget;
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
  const redirect = describeRedirect(params.get("redirect_uri") ?? "");
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
  return { clientId, oauthQuery, redirect, scopes };
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

/**
 * Accept or decline: the URL to send the browser to next (the client's redirect). Accepting is a
 * sensitive action, like creating an API token: the API refuses it from a session over a day old
 * (`session_not_fresh`) and, with two-factor on, without the current code (`totp_required`,
 * `invalid_totp`), which travels in `x-totp-code`.
 */
export async function submitOAuthConsent(input: {
  accept: boolean;
  oauthQuery: string;
  totpCode?: string;
}): Promise<string> {
  const { data } = await api.post<{ redirect: boolean; url: string }>(
    "/api/auth/oauth2/consent",
    { accept: input.accept, oauth_query: input.oauthQuery },
    input.totpCode ? { headers: { "x-totp-code": input.totpCode } } : undefined,
  );
  return data.url;
}

/** How long a session stays fresh enough to consent: the API's sensitive-session age. */
export const CONSENT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isSessionFreshForConsent(
  createdAt: unknown,
  now = Date.now(),
): boolean {
  const created = new Date(
    typeof createdAt === "string" || typeof createdAt === "number"
      ? createdAt
      : Number.NaN,
  ).getTime();
  return (
    Number.isFinite(created) && now - created <= CONSENT_SESSION_MAX_AGE_MS
  );
}
