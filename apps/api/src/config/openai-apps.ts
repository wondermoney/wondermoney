type Env = Readonly<Record<string, string | undefined>>;

/**
 * The token OpenAI's plugin dashboard issues to verify the MCP server's domain
 * (`OPENAI_APPS_CHALLENGE`), served as plain text at `GET /.well-known/openai-apps-challenge`.
 * Whitespace around a pasted value is dropped. Unset or blank: null, and the route answers 404.
 */
export function openAiAppsChallenge(env: Env = process.env): null | string {
  return env['OPENAI_APPS_CHALLENGE']?.trim() || null;
}
