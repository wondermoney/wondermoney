type Env = Readonly<Record<string, string | undefined>>;

/**
 * The read-only MCP server's instance switch.
 *
 * `MCP_ENABLED=false` turns `POST /v1/mcp` into a 404 and reports `features.mcp: false` on
 * `GET /v1/instance`. Anything else (unset, empty, `true`, `1`) leaves it on: the endpoint is
 * authenticated by a personal API token carrying `mcp:read`, so it is not a public surface.
 */
export function isMcpEnabled(env: Env = process.env): boolean {
  const value = env['MCP_ENABLED']?.trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
}

/**
 * `MCP_OAUTH_ENABLED` as the operator set it: `true` (or `1`, `on`, `yes`, as every on/off switch
 * here reads), anything else off. It asks for OAuth on the MCP server, so that a client that knows
 * only the server's URL, such as ChatGPT, can register, sign the person in and ask for their
 * consent. Off by default: it opens unauthenticated client registration, which a self-hosted
 * server should choose.
 */
export function isMcpOAuthSwitchOn(env: Env = process.env): boolean {
  const value = env['MCP_OAUTH_ENABLED']?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

/**
 * Whether OAuth on the MCP server is asked for and possible as far as the switches go: the switch
 * on, and the MCP server itself on (`MCP_ENABLED=false` turns it off too). `mcpOAuthResource`
 * adds the one other condition, an API address that can be an OAuth resource.
 */
export function isMcpOAuthRequested(env: Env = process.env): boolean {
  return isMcpEnabled(env) && isMcpOAuthSwitchOn(env);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * The MCP server's OAuth resource identifier (RFC 8707, RFC 9728): `<API_URL>/v1/mcp`, the URL a
 * client connects to and the audience every access token is bound to. Null when the API's
 * address cannot be one: an OAuth resource must be HTTPS, plain HTTP only on a loopback host for
 * local development. A server on plain HTTP elsewhere keeps OAuth off rather than failing to start.
 */
export function mcpOAuthResource(apiUrl: string): null | string {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/v1/mcp`;
}
