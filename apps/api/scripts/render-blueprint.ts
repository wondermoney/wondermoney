/**
 * Check the Render Blueprint (`render.yaml` at the repository root) against what the API, the
 * worker and the web app need to start.
 *
 *   pnpm --filter @wondermoney/api render:check
 *   pnpm --filter @wondermoney/api render:check -- path/to/render.yaml   (another copy)
 *
 * Each service's environment is resolved the way Render would resolve it: literal values,
 * `generateValue` secrets (a random base64 256-bit value, once per variable), `fromGroup`,
 * `fromDatabase` and `fromService` (including `envVarKey`, which copies another service's
 * variable). `sync: false` variables are what the person deploying types into Render's form; they
 * start empty, and the check reports which of them a deploy cannot start without. Then the
 * resolved environment goes through the same validation the processes run at boot:
 * `loadConfiguration` for the API and the worker, the instance addresses, better-auth's secret,
 * pg-boss's database settings, and the web image's entrypoint (its `${NAME:?...}` lines).
 *
 * It also checks that the three WonderMoney images pin one release, that the API and the worker
 * share the secrets they must agree on, and that the web app and the API either share a hostname
 * or have a cookie domain. With WM_RELEASES set (a JSON array of release tags, newest first, as CI
 * passes it) the pinned release must be one of them, and a warning says when it is not the newest.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { ConfigurationError, loadAuthConfiguration, loadConfiguration } from '../src/config/configuration.js';
import { resolveInstanceUrls } from '../src/config/instance-urls.js';
import { buildPgBossConfig } from '../src/jobs/pgboss.config.js';

type Env = Record<string, string>;

interface EnvVarSpec {
  fromDatabase?: { name: string; property: string };
  fromGroup?: string;
  fromService?: { envVarKey?: string; name: string; property?: string; type: string };
  generateValue?: boolean;
  key?: string;
  sync?: boolean;
  value?: number | string;
}

interface ServiceSpec {
  envVars?: EnvVarSpec[];
  image?: { url: string };
  name: string;
  region?: string;
  type: string;
}

interface Blueprint {
  databases?: { name: string; region?: string }[];
  envVarGroups?: { envVars: EnvVarSpec[]; name: string }[];
  services: ServiceSpec[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const blueprint = parse(readFileSync(process.argv[2] ?? join(repoRoot, 'render.yaml'), 'utf8')) as Blueprint;
const webEntrypoint = readFileSync(join(repoRoot, 'apps/web/docker/entrypoint.sh'), 'utf8');

/** What the api and worker images set themselves (apps/api/Dockerfile, `runtime-base`). */
const SERVER_IMAGE_ENV: Env = { APP_ENV: 'production', DEPLOY_ENV: 'production', NODE_ENV: 'production' };

/** Values the API and the worker must agree on: one encrypts or signs what the other reads. */
const SHARED_SERVER_KEYS = ['APP_URL', 'API_URL', 'CREDENTIAL_ENCRYPTION_KEY_V1', 'EMAIL_OPT_OUT_SIGNING_SECRET'];

/** A variable whose name says it holds a secret never gets a literal value in a public file. */
const SECRET_NAME = /SECRET|PASSWORD|_KEY(?:_|$)|TOKEN/u;

const errors: string[] = [];
const warnings: string[] = [];

const services = new Map(blueprint.services.map((service) => [service.name, service]));
const groups = new Map((blueprint.envVarGroups ?? []).map((group) => [group.name, group]));
const databases = new Map((blueprint.databases ?? []).map((database) => [database.name, database]));

function imageRepository(service: ServiceSpec): null | string {
  const url = service.image?.url;
  if (!url) return null;
  return url.slice(0, url.lastIndexOf(':'));
}

function serviceWithImage(repository: string): ServiceSpec {
  const service = blueprint.services.find((candidate) => imageRepository(candidate) === repository);
  if (!service) throw new Error(`render.yaml has no service running ${repository}`);
  return service;
}

const api = serviceWithImage('ghcr.io/wondermoney/wondermoney-api');
const worker = serviceWithImage('ghcr.io/wondermoney/wondermoney-worker');
const web = serviceWithImage('ghcr.io/wondermoney/wondermoney-web');

// -- Images, regions and literal secrets ----------------------------------------------------

const tags = [api, worker, web].map((service) => service.image!.url.slice(service.image!.url.lastIndexOf(':') + 1));
const pinned = tags[0]!;
if (new Set(tags).size !== 1) errors.push(`the api, worker and web images pin different tags (${tags.join(', ')}); pin one release`);
if (!/^\d+\.\d+\.\d+$/u.test(pinned)) errors.push(`the images pin "${pinned}"; pin a released version such as 1.4.0, not a moving tag`);
if (api.type !== 'web' || web.type !== 'web' || worker.type !== 'worker') {
  errors.push('the api and web images run as web services and the worker image as a background worker');
}

const releases = process.env['WM_RELEASES'] ? JSON.parse(process.env['WM_RELEASES']) as string[] : null;
if (releases) {
  if (!releases.includes(`v${pinned}`)) errors.push(`the images pin ${pinned}, which is not a published release`);
  else if (releases[0] !== `v${pinned}`) warnings.push(`render.yaml pins ${pinned}, but the latest release is ${releases[0]}: bump the image tags (CONTRIBUTING.md, "Releasing")`);
}

const regions = new Set([...blueprint.services, ...databases.values()].map((resource) => resource.region ?? 'oregon'));
if (regions.size !== 1) errors.push(`the services and the database are in different regions (${[...regions].join(', ')})`);

for (const [owner, specs] of [
  ...blueprint.services.map((service) => [`service ${service.name}`, service.envVars ?? []] as const),
  ...[...groups.values()].map((group) => [`group ${group.name}`, group.envVars] as const),
]) {
  for (const spec of specs) {
    if (spec.key && spec.value !== undefined && SECRET_NAME.test(spec.key)) {
      errors.push(`${owner} commits a value for ${spec.key}; use generateValue or sync: false`);
    }
  }
}

// -- Resolving each service's environment ---------------------------------------------------

/** One value per generated variable, as Render keeps it once created. */
const generated = new Map<string, string>();
const generate = (owner: string, key: string) => {
  const id = `${owner}/${key}`;
  if (!generated.has(id)) generated.set(id, randomBytes(32).toString('base64'));
  return generated.get(id)!;
};

const DATABASE_SAMPLE: Record<string, string> = {
  database: 'wondermoney',
  host: 'dpg-sample-a',
  password: randomBytes(16).toString('hex'),
  port: '5432',
  user: 'wondermoney',
};

/** The deploy form: a variable maps to what the person types, or is absent while left empty. */
type Prompts = ReadonlyMap<string, string>;

/** A service's variables with its groups expanded, each with the owner a generated value belongs to. */
function specsOf(service: ServiceSpec): { owner: string; spec: EnvVarSpec }[] {
  return (service.envVars ?? []).flatMap((spec) => {
    if (!spec.fromGroup) return [{ owner: service.name, spec }];
    const group = groups.get(spec.fromGroup);
    if (!group) errors.push(`${service.name} uses group ${spec.fromGroup}, which render.yaml does not define`);
    return (group?.envVars ?? []).map((inner) => ({ owner: `group:${spec.fromGroup}`, spec: inner }));
  });
}

function declaredKeys(service: ServiceSpec): Set<string> {
  return new Set(specsOf(service).map(({ spec }) => spec.key!));
}

/** One variable's value, or undefined while it is an empty prompt (or copies one). */
function resolveVar(service: ServiceSpec, key: string, prompts: Prompts, seen: string[] = []): string | undefined {
  const id = `${service.name}.${key}`;
  if (seen.includes(id)) throw new Error(`render.yaml has a reference cycle: ${[...seen, id].join(' -> ')}`);
  const found = specsOf(service).find(({ spec }) => spec.key === key);
  if (!found) return undefined;
  const { owner, spec } = found;
  if (spec.value !== undefined) return String(spec.value);
  if (spec.generateValue) return generate(owner, key);
  if (spec.sync === false) return prompts.get(`${service.name}/${key}`);
  if (spec.fromDatabase) {
    if (!databases.has(spec.fromDatabase.name)) errors.push(`${id} reads database ${spec.fromDatabase.name}, which render.yaml does not define`);
    const value = DATABASE_SAMPLE[spec.fromDatabase.property];
    if (value === undefined) errors.push(`${id} reads database property ${spec.fromDatabase.property}`);
    return value;
  }
  if (spec.fromService) {
    const target = services.get(spec.fromService.name);
    if (!target || target.type !== spec.fromService.type) {
      errors.push(`${id} reads ${spec.fromService.type} service ${spec.fromService.name}, which render.yaml does not define`);
      return undefined;
    }
    const { envVarKey } = spec.fromService;
    if (envVarKey) {
      if (!declaredKeys(target).has(envVarKey)) errors.push(`${id} copies ${target.name}.${envVarKey}, which ${target.name} does not set`);
      return resolveVar(target, envVarKey, prompts, [...seen, id]);
    }
    // Render's private network: the service's name and the port it listens on (PORT, else 10000).
    const port = resolveVar(target, 'PORT', prompts, [...seen, id]) ?? '10000';
    const property: Record<string, string> = { host: target.name, hostport: `${target.name}:${port}`, port };
    const value = property[spec.fromService.property ?? ''];
    if (value === undefined) errors.push(`${id} reads service property ${spec.fromService.property}`);
    return value;
  }
  errors.push(`${id} has no value, generateValue, sync: false or reference`);
  return undefined;
}

function resolve(service: ServiceSpec, prompts: Prompts): Env {
  const env: Env = {};
  for (const key of declaredKeys(service)) {
    const value = resolveVar(service, key, prompts);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function promptedKeys(service: ServiceSpec): string[] {
  return (service.envVars ?? []).filter((spec) => spec.sync === false).map((spec) => `${service.name}/${spec.key}`);
}

// -- What each process checks when it starts ------------------------------------------------

/** The names a process refuses to start without, or a message for a value it rejects. */
interface BootResult { invalid: string[]; missing: string[] }

function bootServer(role: 'api' | 'worker', raw: Env): BootResult {
  const env = { ...SERVER_IMAGE_ENV, ...raw };
  const result: BootResult = { invalid: [], missing: [] };
  const has = (key: string) => (env[key] ?? '').trim() !== '';
  try {
    loadConfiguration(role, env);
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    for (const issue of error.issues) {
      if (issue.path === 'database') result.missing.push(...['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME'].filter((key) => !has(key)));
      else if (issue.code === 'missing') result.missing.push(issue.path);
      else result.invalid.push(`${issue.path}: ${issue.message}`);
    }
  }
  // utils/constants.ts resolves them when the API and the worker load.
  try {
    resolveInstanceUrls(env, 'production');
  } catch {
    if (!has('APP_URL')) result.missing.push('APP_URL');
    if (!has('API_URL') && !has('BETTER_AUTH_URL')) result.missing.push('API_URL');
  }
  // pg-boss builds its own connection string from the DB_* settings, password included.
  try {
    buildPgBossConfig(env);
  } catch (error) {
    const absent = ['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'].filter((key) => !has(key));
    if (absent.length > 0) result.missing.push(...absent);
    else result.invalid.push(error instanceof Error ? error.message : String(error));
  }
  // services/auth/better-auth.ts refuses to load without it outside development.
  if (role === 'api' && !loadAuthConfiguration(env).betterAuthSecret) result.missing.push('BETTER_AUTH_SECRET');
  return { invalid: result.invalid, missing: [...new Set(result.missing)] };
}

/** The web image's entrypoint stops on every `: "${NAME:?...}"` line whose variable is empty. */
function bootWeb(env: Env): BootResult {
  const required = [...webEntrypoint.matchAll(/^: "\$\{(\w+):\?/gmu)].map((match) => match[1]!);
  if (required.length === 0) errors.push('found no required variables in apps/web/docker/entrypoint.sh; the check no longer matches it');
  return { invalid: [], missing: required.filter((key) => (env[key] ?? '').trim() === '') };
}

const boots: [ServiceSpec, (env: Env) => BootResult][] = [
  [api, (env) => bootServer('api', env)],
  [worker, (env) => bootServer('worker', env)],
  [web, bootWeb],
];

/** A value of the right shape for each variable a deploy has to be given. */
function sample(key: string): string {
  if (key === 'CREDENTIAL_ENCRYPTION_KEY_V1') return randomBytes(32).toString('base64');
  if (key.endsWith('_URL')) return 'https://money.example.com';
  return `sample-${key.toLowerCase()}`;
}

// Pass 1: every prompt left empty. Whatever a process then misses has to be a prompt.
const prompts = new Map<string, string>();
const allPrompts = new Set(blueprint.services.flatMap(promptedKeys));
for (let round = 0; round < 10; round++) {
  let added = false;
  for (const [service, boot] of boots) {
    for (const key of boot(resolve(service, prompts)).missing) {
      // The variable is either typed in on this service or copied from one where it is.
      const origin = findPrompt(service, key);
      if (!origin) {
        errors.push(`${service.name} cannot start without ${key}, and render.yaml neither sets it nor asks for it`);
        continue;
      }
      if (!prompts.has(origin)) {
        prompts.set(origin, sample(origin.slice(origin.indexOf("/") + 1)));
        added = true;
      }
    }
  }
  if (!added) break;
}

/** Where the deploy form asks for the value `service.key` ends up with, following `envVarKey`. */
function findPrompt(service: ServiceSpec, key: string): null | string {
  const spec = (service.envVars ?? []).find((candidate) => candidate.key === key);
  if (!spec) return null;
  if (spec.sync === false) return allPrompts.has(`${service.name}/${key}`) ? `${service.name}/${key}` : null;
  if (spec.fromService?.envVarKey) {
    const target = services.get(spec.fromService.name);
    return target ? findPrompt(target, spec.fromService.envVarKey) : null;
  }
  return null;
}

// Pass 2: with those filled in, every process starts.
const resolved = new Map(boots.map(([service]) => [service.name, resolve(service, prompts)]));
for (const [service, boot] of boots) {
  const result = boot(resolved.get(service.name)!);
  for (const key of result.missing) errors.push(`${service.name} still misses ${key} with every required prompt filled in`);
  for (const problem of result.invalid) errors.push(`${service.name} rejects its configuration: ${problem}`);
}

// -- Agreement between the services ---------------------------------------------------------

const apiEnv = resolved.get(api.name)!;
const workerEnv = resolved.get(worker.name)!;
const webEnv = resolved.get(web.name)!;
for (const key of SHARED_SERVER_KEYS) {
  if (apiEnv[key] !== workerEnv[key]) errors.push(`the API and the worker get different ${key} values; give both the same one (a shared group or envVarKey)`);
}
if (webEnv['NEXT_PUBLIC_APP_URL'] !== apiEnv['APP_URL']) errors.push('the web app\'s NEXT_PUBLIC_APP_URL is not the API\'s APP_URL');
if (webEnv['NEXT_PUBLIC_API_URL'] !== apiEnv['API_URL']) errors.push('the web app\'s NEXT_PUBLIC_API_URL is not the API\'s API_URL');

const hostname = (url: string | undefined) => {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return null;
  }
};
const oneHostname = hostname(apiEnv['APP_URL']) !== null && hostname(apiEnv['APP_URL']) === hostname(apiEnv['API_URL']);
if (!oneHostname && (!apiEnv['AUTH_COOKIE_DOMAIN'] || !webEnv['NEXT_PUBLIC_AUTH_COOKIE_DOMAIN'])) {
  errors.push('the web app and the API are on different hostnames without AUTH_COOKIE_DOMAIN and NEXT_PUBLIC_AUTH_COOKIE_DOMAIN');
}

// -- Report ---------------------------------------------------------------------------------

const required = [...prompts.keys()].sort();
const optional = [...allPrompts].filter((key) => !prompts.has(key)).sort();
console.log(`render.yaml pins ${pinned}; ${oneHostname ? 'one hostname for the web app and the API' : 'two hostnames'}.`);
console.log(`Asked for at deploy, required: ${required.join(', ') || 'none'}`);
console.log(`Asked for at deploy, optional: ${optional.join(', ') || 'none'}`);
for (const warning of warnings) console.log(process.env['GITHUB_ACTIONS'] ? `::warning::${warning}` : `warning: ${warning}`);
if (errors.length > 0) {
  for (const error of [...new Set(errors)]) console.error(process.env['GITHUB_ACTIONS'] ? `::error::${error}` : `error: ${error}`);
  process.exit(1);
}
console.log('Every service gets what it needs to start.');
