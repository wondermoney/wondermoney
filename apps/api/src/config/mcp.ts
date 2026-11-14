/**
 * The read-only MCP server's instance switch.
 *
 * `MCP_ENABLED=false` turns `POST /v1/mcp` into a 404 and reports `features.mcp: false` on
 * `GET /v1/instance`. Anything else (unset, empty, `true`, `1`) leaves it on: the endpoint is
 * authenticated by a personal API token carrying `mcp:read`, so it is not a public surface.
 */
export function isMcpEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env['MCP_ENABLED']?.trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
}
