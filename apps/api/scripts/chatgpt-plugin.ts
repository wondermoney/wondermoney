/**
 * Check the ChatGPT plugin package (`integrations/chatgpt-plugin` at the repository root) the way
 * OpenAI's upload and review read it.
 *
 *   pnpm --filter @wondermoney/api chatgpt-plugin:check
 *   pnpm --filter @wondermoney/api chatgpt-plugin:check -- --urls   (also fetch every URL it names)
 *
 * - `plugin.json` and `mcp.json` against the Agent Plugins 1.0.0 schemas, vendored in
 *   `integrations/chatgpt-plugin/schemas` (refresh them from https://agent-plugins.org/schemas/).
 *   The MCP schema closes each server object, while OpenAI documents its authentication under
 *   the server's own `extensions["com.openai"]`, so that one member is checked by the OpenAI rules
 *   below instead of the schema.
 * - OpenAI's submission limits (developers.openai.com/plugins/deploy/submission, "Manifest
 *   fields"): name, version, text lengths, https listing URLs, at most three default prompts of
 *   128 characters, brand colors with 2:1 contrast against white and #212121, square icons of
 *   48 to 4096 pixels and at most 5 MiB, exactly five positive and three negative review cases,
 *   and none of the fields the upload rejects (credentials, reviewer instructions, app
 *   references, hooks, a client secret, server headers).
 * - The review cases name real tools: every `tools_triggered` name is in `AI_TOOL_NAMES`, the
 *   read tools an OAuth client (ChatGPT, `mcp:read`) is given, and the server asks only for
 *   scopes the authorization server knows.
 *
 * With `--urls` it also fetches every listing URL (each must answer 200 itself, not redirect) and
 * checks that the MCP endpoint asks for OAuth and serves its protected resource metadata. That
 * needs the network, so CI leaves it out.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

// Importing the tool definitions loads the app's modules, and some of those validate their
// environment at import time. Nothing here opens a connection, so inert placeholders are enough
// (as in scripts/openapi.ts); placeholder DB_* settings beside a DATABASE_URL would be refused.
delete process.env['DATABASE_URL'];
Object.assign(process.env, {
  DB_DATABASE: process.env['DB_DATABASE'] ?? 'chatgpt-plugin-check',
  DB_HOST: process.env['DB_HOST'] ?? 'localhost',
  DB_PASSWORD: process.env['DB_PASSWORD'] ?? 'chatgpt-plugin-check',
  DB_PORT: process.env['DB_PORT'] ?? '5432',
  DB_USERNAME: process.env['DB_USERNAME'] ?? 'chatgpt-plugin-check',
  NODE_ENV: process.env['NODE_ENV'] ?? 'test',
});

// The app module first: the tool definitions sit in an import cycle that resolves from there.
await import('../src/app.js');
const { AI_TOOL_NAMES } = await import('../src/services/ai-tools/ai-tools.service.js');
const { MCP_OAUTH_SCOPES } = await import('../src/services/mcp/mcp-oauth-config.js');

type Json = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..', '..', '..', 'integrations', 'chatgpt-plugin');
const checkUrls = process.argv.includes('--urls');

const problems: string[] = [];
const fail = (where: string, message: string) => problems.push(`${where}: ${message}`);

const readJson = (name: string): Json => JSON.parse(readFileSync(join(pluginRoot, name), 'utf8')) as Json;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const objectAt = (value: unknown): Json => (isObject(value) ? value : {});

const plugin = readJson('plugin.json');
const mcp = readJson('mcp.json');

// -- Schemas ------------------------------------------------------------------------------------

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validatePlugin = ajv.compile(readJson('schemas/plugin.schema.json'));
const validateMcp = ajv.compile(readJson('schemas/mcp.schema.json'));

if (!validatePlugin(plugin)) {
  for (const error of validatePlugin.errors ?? []) fail('plugin.json', `schema: ${error.instancePath || '/'} ${error.message ?? ''}`);
}
// The portable schema without OpenAI's per-server extension, which it does not know about.
const portableMcp = structuredClone(mcp);
for (const server of Object.values(objectAt(portableMcp['mcpServers']))) {
  if (isObject(server)) delete server['extensions'];
}
if (!validateMcp(portableMcp)) {
  for (const error of validateMcp.errors ?? []) fail('mcp.json', `schema: ${error.instancePath || '/'} ${error.message ?? ''}`);
}

// -- Fields the upload rejects, anywhere -------------------------------------------------------

const REJECTED_KEYS = new Set(['clientSecret', 'reviewer_instructions', 'test_credentials']);
function findRejected(file: string, value: unknown, path: string): void {
  if (Array.isArray(value)) value.forEach((item, index) => { findRejected(file, item, `${path}[${index}]`); });
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (REJECTED_KEYS.has(key)) fail(file, `${path}.${key} is rejected by the upload; enter it in the dashboard instead`);
    findRejected(file, child, `${path}.${key}`);
  }
}
findRejected('plugin.json', plugin, '');
findRejected('mcp.json', mcp, '');

// -- Package identity -----------------------------------------------------------------------------

function text(where: string, value: unknown, max: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(where, 'must be a non-empty string');
    return undefined;
  }
  if (value.length > max) fail(where, `is ${value.length} characters; at most ${max}`);
  return value;
}

function httpsUrl(where: string, value: unknown, max: number, required = true): void {
  const url = text(where, value, max, required);
  if (url === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(where, `${url} is not a URL`);
    return;
  }
  if (parsed.protocol !== 'https:') fail(where, `${url} must be https`);
  if (parsed.username || parsed.password) fail(where, `${url} must not embed credentials`);
}

const SUBMISSION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const name = text('plugin.json name', plugin['name'], 64);
if (name !== undefined && !SUBMISSION_NAME.test(name)) fail('plugin.json name', 'use lowercase letters, numbers and single hyphens');
const version = text('plugin.json version', plugin['version'], 64);
if (version !== undefined && !SEMVER.test(version)) fail('plugin.json version', `${version} is not a semantic version`);
text('plugin.json description', plugin['description'], 4000, false);
const author = objectAt(plugin['author']);
text('plugin.json author.name', author['name'], 120);
text('plugin.json author.email', author['email'], 320, false);
httpsUrl('plugin.json author.url', author['url'], 2048, false);
httpsUrl('plugin.json homepage', plugin['homepage'], 2048, false);
httpsUrl('plugin.json repository', plugin['repository'], 2048, false);
const keywords = plugin['keywords'];
if (Array.isArray(keywords) && keywords.length > 25) fail('plugin.json keywords', `${keywords.length} keywords; at most 25`);

const openai = objectAt(objectAt(plugin['extensions'])['com.openai']);
for (const key of ['apps', 'hooks']) {
  if (key in openai) fail(`plugin.json extensions.com.openai.${key}`, 'packages with app references or lifecycle hooks cannot be submitted');
}

// -- Listing --------------------------------------------------------------------------------------

const ui = objectAt(openai['interface']);
const at = (field: string) => `plugin.json interface.${field}`;
text(at('displayName'), ui['displayName'], 30);
text(at('shortDescription'), ui['shortDescription'], 30);
text(at('longDescription'), ui['longDescription'], 4000);
text(at('developerName'), ui['developerName'], 80);
text(at('category'), ui['category'], 80);
for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) httpsUrl(at(field), ui[field], 1024);

const prompts = typeof ui['defaultPrompt'] === 'string' ? [ui['defaultPrompt']] : ui['defaultPrompt'];
if (prompts !== undefined) {
  if (!Array.isArray(prompts)) fail(at('defaultPrompt'), 'must be a string or an array of strings');
  else {
    if (prompts.length > 3) fail(at('defaultPrompt'), `${prompts.length} prompts; at most 3`);
    if (new Set(prompts).size !== prompts.length) fail(at('defaultPrompt'), 'prompts must be unique');
    prompts.forEach((prompt, index) => {
      const value = text(`${at('defaultPrompt')}[${index}]`, prompt, 128);
      if (value?.includes('@')) fail(`${at('defaultPrompt')}[${index}]`, 'leave out @mentions');
    });
  }
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
for (const [field, background] of [['brandColor', '#FFFFFF'], ['brandColorDark', '#212121']] as const) {
  const color = ui[field];
  if (color === undefined) continue;
  if (typeof color !== 'string' || !HEX.test(color)) {
    fail(at(field), 'must be #RRGGBB');
    continue;
  }
  const ratio = contrast(color, background);
  if (ratio < 2) fail(at(field), `${color} has ${ratio.toFixed(2)}:1 contrast against ${background}; at least 2:1`);
}

/** Width and height of a PNG (its IHDR chunk) or an SVG (width/height, else its viewBox). */
function imageSize(file: string): null | { height: number; width: number } {
  const bytes = readFileSync(file);
  if (file.endsWith('.png')) {
    if (bytes.toString('latin1', 1, 4) !== 'PNG' || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
  }
  if (file.endsWith('.svg')) {
    const svg = /<svg\b[^>]*>/i.exec(bytes.toString('utf8'))?.[0] ?? '';
    const attribute = (key: string) => new RegExp(`\\s${key}="([^"]+)"`, 'i').exec(svg)?.[1];
    const [width, height] = [attribute('width'), attribute('height')].map((value) => Number.parseFloat(value ?? ''));
    if (Number.isFinite(width) && Number.isFinite(height)) return { height: height!, width: width! };
    const box = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    return box?.length === 4 ? { height: box[3]!, width: box[2]! } : null;
  }
  return null;
}

for (const field of ['logo', 'composerIcon', 'logoDark', 'composerIconDark']) {
  const value = ui[field];
  if (value === undefined) {
    if (field === 'logo' || field === 'composerIcon') fail(at(field), 'is required for submission');
    continue;
  }
  if (typeof value !== 'string' || !value.startsWith('./')) {
    fail(at(field), 'must be a ./-prefixed path relative to the plugin root');
    continue;
  }
  const file = resolve(pluginRoot, value);
  if (!file.startsWith(pluginRoot + sep) || !existsSync(file)) {
    fail(at(field), `${value} is not a file in the package`);
    continue;
  }
  if (!/\.(png|svg)$/.test(file)) fail(at(field), `${value}: use a PNG or an SVG (this check reads their size)`);
  if (statSync(file).size > 5 * 1024 * 1024) fail(at(field), `${value} is over 5 MiB`);
  const size = imageSize(file);
  if (!size) fail(at(field), `${value}: could not read its size`);
  else if (size.width !== size.height || size.width < 48 || (file.endsWith('.png') && size.width > 4096)) {
    fail(at(field), `${value} is ${size.width}x${size.height}; it must be square, at least 48 and at most 4096 pixels`);
  }
}

// -- Review cases -----------------------------------------------------------------------------

const tools = new Set<string>(AI_TOOL_NAMES);
const cases = objectAt(objectAt(openai['review'])['test_cases']);
const positive = Array.isArray(cases['positive']) ? cases['positive'] : [];
const negative = Array.isArray(cases['negative']) ? cases['negative'] : [];
if (positive.length !== 5) fail('plugin.json review.test_cases.positive', `${positive.length} cases; initial review needs exactly 5`);
if (negative.length !== 3) fail('plugin.json review.test_cases.negative', `${negative.length} cases; initial review needs exactly 3`);
positive.forEach((testCase: unknown, index) => {
  const where = `plugin.json review.test_cases.positive[${index}]`;
  const entry = objectAt(testCase);
  text(`${where}.description`, entry['description'], 4000);
  text(`${where}.prompt`, entry['prompt'], 4000);
  text(`${where}.expected_behavior`, entry['expected_behavior'], 4000);
  const triggered = text(`${where}.tools_triggered`, entry['tools_triggered'], 4000);
  for (const tool of triggered?.split(',').map((part) => part.trim()) ?? []) {
    if (!tools.has(tool)) fail(`${where}.tools_triggered`, `${tool} is not a read tool (AI_TOOL_DEFINITIONS)`);
  }
});
negative.forEach((testCase: unknown, index) => {
  const where = `plugin.json review.test_cases.negative[${index}]`;
  const entry = objectAt(testCase);
  text(`${where}.description`, entry['description'], 4000);
  text(`${where}.prompt`, entry['prompt'], 4000);
});

const translations = objectAt(objectAt(openai['publication'])['translations']);
for (const [locale, translation] of Object.entries(translations)) {
  text(`plugin.json publication.translations.${locale}.subtitle`, objectAt(translation)['subtitle'], 30, false);
  text(`plugin.json publication.translations.${locale}.description`, objectAt(translation)['description'], 4000, false);
}

// -- MCP server -------------------------------------------------------------------------------

const servers = Object.entries(objectAt(mcp['mcpServers']));
if (servers.length !== 1) fail('mcp.json mcpServers', `${servers.length} servers; plugin-level review cases need exactly one`);
const knownScopes = new Set<string>(MCP_OAUTH_SCOPES);
for (const [serverName, value] of servers) {
  const where = `mcp.json mcpServers.${serverName}`;
  const server = objectAt(value);
  if (server['type'] !== 'streamable-http') fail(`${where}.type`, 'public submission needs a remote streamable-http server');
  httpsUrl(`${where}.url`, server['url'], 2048);
  if (Object.keys(objectAt(server['headers'])).length > 0) fail(`${where}.headers`, 'public submission rejects non-empty server headers');
  const auth = objectAt(objectAt(objectAt(server['extensions'])['com.openai'])['auth']);
  if (auth['type'] !== 'oauth' && auth['type'] !== 'mixed') fail(`${where} auth.type`, 'the MCP server needs OAuth (`oauth`)');
  const client = objectAt(auth['client']);
  if (client['mode'] !== 'dcr') fail(`${where} auth.client.mode`, 'the server registers clients dynamically: use `dcr`');
  if ('clientId' in client) fail(`${where} auth.client.clientId`, 'a dcr client carries no client ID');
  for (const field of ['baseScopes', 'defaultScopes']) {
    const scopes = auth[field];
    if (scopes === undefined) continue;
    if (!Array.isArray(scopes)) fail(`${where} auth.${field}`, 'must be an array');
    else for (const scope of scopes) if (!knownScopes.has(String(scope))) fail(`${where} auth.${field}`, `${String(scope)} is not a scope the server grants (${[...knownScopes].join(', ')})`);
  }
}

// -- URLs (with --urls) -----------------------------------------------------------------------

if (checkUrls) {
  const listingUrls = [
    author['url'], plugin['homepage'], plugin['repository'],
    ui['websiteURL'], ui['supportURL'], ui['privacyPolicyURL'], ui['termsOfServiceURL'],
  ].filter((url): url is string => typeof url === 'string');
  for (const url of new Set(listingUrls)) {
    const response = await fetch(url, { redirect: 'manual' }).catch((error: unknown) => error as Error);
    if (response instanceof Error) fail(url, response.message);
    else if (response.status !== 200) fail(url, `answered ${response.status}${response.headers.get('location') ? ` (to ${response.headers.get('location')})` : ''}; it must answer 200`);
    else console.log(`200 ${url}`);
  }
  for (const [serverName, value] of servers) {
    const url = objectAt(value)['url'];
    if (typeof url !== 'string') continue;
    const response = await fetch(url, {
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list' }),
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(response.headers.get('www-authenticate') ?? '')?.[1];
    if (response.status !== 401 || !metadataUrl) {
      fail(`mcp.json mcpServers.${serverName}`, `${url} answered ${response.status} without a resource_metadata challenge; is MCP_OAUTH_ENABLED on?`);
      continue;
    }
    const metadata = await fetch(metadataUrl);
    if (metadata.status !== 200) fail(`mcp.json mcpServers.${serverName}`, `${metadataUrl} answered ${metadata.status}`);
    else console.log(`401 ${url}, OAuth metadata 200 at ${metadataUrl}`);
  }
}

const where = relative(process.cwd(), pluginRoot) || '.';
if (problems.length > 0) {
  console.error(`ChatGPT plugin package (${where}): ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`ChatGPT plugin package (${where}): OK${checkUrls ? ', URLs included' : ''}`);
process.exit(0);
