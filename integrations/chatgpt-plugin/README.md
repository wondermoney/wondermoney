# WonderMoney ChatGPT plugin

The source of the package OpenAI's plugin directory takes for ChatGPT: an
[Agent Plugins](https://agent-plugins.org) package that lists WonderMoney and points at the
hosted read-only MCP server, `https://api.wonder.money/v1/mcp`. OpenAI's guides:
[package your plugin](https://developers.openai.com/plugins/build/plugins),
[upload and submit](https://developers.openai.com/plugins/deploy/submission) and the
[plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines).

| File | What |
|---|---|
| `plugin.json` | The manifest: identity, the listing (`extensions.com.openai.interface`), the review cases (`extensions.com.openai.review`) and the release notes (`extensions.com.openai.publication`) |
| `mcp.json` | The one MCP server, Streamable HTTP, with OAuth through dynamic client registration and the `mcp:read` and `offline_access` scopes. No headers and no credentials |
| `assets/` | `logo.png` (1024 px) and `composer-icon.png` (256 px), from the mobile app's icon |
| `schemas/` | The Agent Plugins 1.0.0 schemas the check validates against. Not part of the ZIP |

Only `plugin.json`, `mcp.json` and `assets/` go into the ZIP, at its root.

## Check it

```bash
pnpm --filter @wondermoney/api chatgpt-plugin:check            # what CI runs
pnpm --filter @wondermoney/api chatgpt-plugin:check -- --urls  # also fetches every URL it names
```

It validates both files against the schemas, then OpenAI's submission rules: text lengths, https
listing URLs, at most three default prompts, brand colors with 2:1 contrast, square icons, exactly
five positive and three negative review cases, and none of the fields the upload rejects
(`test_credentials`, `reviewer_instructions`, `clientSecret`, `apps`, `hooks`, server headers).
Every tool a review case names must be one of the read tools in `AI_TOOL_DEFINITIONS`
(`apps/api/src/services/ai-tools/ai-tools.service.ts`), so renaming a tool fails the check until
the case is updated. With `--urls`, each listing URL must answer 200 without a redirect, and the
MCP server must answer 401 with an OAuth challenge whose metadata loads.

`baseScopes` asks for `offline_access` beside `mcp:read`. ChatGPT sends the base scopes on every
OAuth request, and the authorization server issues a refresh token only for `offline_access`.
With `mcp:read` alone, ChatGPT got no refresh token, so its connection ended when the 15-minute
access token expired. `offline_access` reads nothing: the tools stay the read tools of `mcp:read`.

`mcp.json` keeps OpenAI's authentication under the server's own `extensions["com.openai"]`, as
OpenAI's guide places it. The Agent Plugins schema closes the server object and has no room for
it, so the check validates the server without that member and checks the member against OpenAI's
rules instead.

To refresh the schemas:

```bash
curl -fsSLo schemas/plugin.schema.json https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
curl -fsSLo schemas/mcp.schema.json https://agent-plugins.org/schemas/1.0.0/mcp.schema.json
```

## Build the ZIP

From this directory:

```bash
rm -f wondermoney-chatgpt-plugin.zip
zip -X -r wondermoney-chatgpt-plugin.zip plugin.json mcp.json assets
unzip -l wondermoney-chatgpt-plugin.zip   # plugin.json, mcp.json and assets/ at the root
```

Don't commit the ZIP. Bump `version` (and `publication.release_notes`) for every new upload.

## Submit

1. In [Plugins](https://platform.openai.com/plugins), **Upload new or existing plugin**, choose the
   verified developer identity for Radix Catch, Lda., and upload the ZIP.
2. **Metadata & Skills**: wait for the checks. To fix a finding, change the files here, run the
   check, build a new ZIP and use **Upload plugin to fix issues**.
3. **MCPs → Connect**: the portal shows a domain-verification token. Set it as
   `OPENAI_APPS_CHALLENGE` on the hosted API and confirm it is served:
   `curl https://api.wonder.money/.well-known/openai-apps-challenge` prints the token alone. Then
   connect, sign in with the review account and allow access. Use **Rescan** after the server's
   tools change and **Reconnect** for connection problems.
4. **Review information → Review details**: the review cases come from `plugin.json` and are
   read-only there; edit them here and upload again. Enter the reviewer credentials there, never
   in the package: an account on wonder.money with sample data (accounts, a budget, recurring
   payments, a portfolio) and without two-factor authentication, which the consent step would
   otherwise ask for. Add the walkthrough video's URL (`review.demo_recording_url`, required for
   review) there or in `plugin.json`.
5. **Submit for review**. Once it is approved, **Publish plugin**.

After publication OpenAI rescans the MCP server daily, so tool changes on the server need no new
ZIP. Listing, review and asset changes do.

## Review cases

The five positive and three negative cases are in `plugin.json` under
`extensions.com.openai.review.test_cases`, which the upload imports. Run each against the review
account before submitting. The positive cases name the tools ChatGPT should call
(`tools_triggered`); the negative cases ask for things no tool can do: moving money, changing a
transaction, trading.
