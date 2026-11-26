/**
 * The decision behind `scripts/assert-local-db.mjs`: may a `package.json` database script run
 * against the target the environment resolves to? The script loads `.env` (`loadDotenv`), calls
 * this, prints the message and exits with its status. The header of that script explains the
 * two tiers and the limits of a host-only check.
 *
 * The target is the one the scripts connect to (`database-target.ts`): the host and database of
 * `DATABASE_URL` as `pg` reads it when it is set, else `DB_HOST` and `DB_DATABASE`. A
 * `DATABASE_URL` that does not parse, one whose query would replace its host, port or user, and
 * one set beside `DB_*` are refused, as the scripts themselves refuse them.
 *
 * Plain TypeScript, so the script can import it under Node's type stripping (hence the `.ts`
 * extension on the import).
 */
import { databaseUrlProblem, databaseUrlSetting, parseDatabaseUrl } from './database-target.ts';


const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'localhost',
  // docker-compose service names: inside the compose network these *are* the local database.
  'db',
  'host.docker.internal',
  'postgres',
]);

/**
 * MikroORM reads these from the environment (`.env` included) and merges them into the options,
 * so they can move the connection away from the `DB_*` target this guard checks.
 */
const MIKRO_ORM_TARGET_KEYS = ['MIKRO_ORM_CLIENT_URL', 'MIKRO_ORM_HOST', 'MIKRO_ORM_DB_NAME'] as const;

export interface LocalDbGuardInput {
  /** The script name, for the messages. */
  readonly command: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** A writing (not dropping) command: a remote target is allowed with `ALLOW_REMOTE_DB=1`. */
  readonly optIn: boolean;
}

export interface LocalDbGuardResult {
  readonly allowed: boolean;
  /** `warn` for an allowed remote write, so the script prints it loudly. */
  readonly level: 'error' | 'ok' | 'warn';
  readonly message: string;
}

export function isLocalDbHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/u, '$1');
  return LOCAL_HOSTS.has(normalized);
}

/** May `command` run against the target `env` resolves to, and what to print either way. */
export function checkLocalDbTarget({ command, env, optIn }: LocalDbGuardInput): LocalDbGuardResult {
  const urlProblem = databaseUrlProblem(env);
  if (urlProblem) {
    return {
      allowed: false,
      level: 'error',
      message: `\n✖ Refusing to run ${command}: ${urlProblem.message}.\n`,
    };
  }

  const { database, host, port, source } = resolveTarget(env);
  const target = source === 'DATABASE_URL'
    ? `    DATABASE_URL host ${host}, port ${port || '(default)'}, database ${database}\n`
    : `    DB_HOST     ${host}\n    DB_PORT     ${port || '(unset)'}\n    DB_DATABASE ${database || '(unset)'}\n`;

  const override = mikroOrmOverrideProblem(env);
  if (override) {
    return {
      allowed: false,
      level: 'error',
      message:
        `\n✖ Refusing to run ${command}: ${override} is set.\n\n`
        + '  MikroORM merges MIKRO_ORM_* connection settings into its options, so the command could\n'
        + '  connect somewhere other than the DB_* target this check verifies. Unset it (in the shell\n'
        + '  and in .env) and give the target as DB_HOST / DB_PORT / DB_DATABASE.\n',
    };
  }

  if (host === '') {
    return {
      allowed: false,
      level: 'error',
      message:
        `\n✖ Refusing to run ${command}: DB_HOST is not set, so the target database cannot be verified.\n`
        + '  Set a local DB_HOST in .env (see .env.sample) before running a destructive command.\n',
    };
  }

  if (isLocalDbHost(host)) {
    const named = source === 'DATABASE_URL' ? `DATABASE_URL host ${host}, database ${database}` : `DB_HOST=${host}, DB_DATABASE=${database || '(unset)'}`;
    return { allowed: true, level: 'ok', message: `✔ ${command}: target is local (${named}).` };
  }

  if (optIn && env['ALLOW_REMOTE_DB'] === '1') {
    // Deliberate remote write. Say so loudly: the point is that it cannot happen silently.
    return {
      allowed: true,
      level: 'warn',
      message: `\n⚠ ${command} is targeting a REMOTE database, because ALLOW_REMOTE_DB=1 is set.\n\n${target}`,
    };
  }

  if (optIn) {
    return {
      allowed: false,
      level: 'error',
      message:
        `\n✖ Refusing to run ${command} against a non-local database.\n\n${target}\n`
        + '  This command WRITES to the target database, and the `dev` in its name does not\n'
        + '  make the target local — it connects to whatever .env resolves to.\n\n'
        + `  If that is genuinely what you want, state it:  ALLOW_REMOTE_DB=1 pnpm ${command}\n`,
    };
  }

  return {
    allowed: false,
    level: 'error',
    message:
      `\n✖ Refusing to run ${command} against a non-local database.\n\n${target}\n`
      + '  This command DROPS the entire database. It is only ever allowed against a\n'
      + `  disposable local/CI database (${[...LOCAL_HOSTS].join(', ')}).\n\n`
      + '  If you meant to target a local database, fix the DB_* block in .env — and make\n'
      + '  sure there is only ONE of them, because dotenv keeps the last assignment.\n'
      + '  To move a real database forward, use the non-destructive `pnpm migrate:dev`.\n',
  };
}

/** A URL whose host, as `pg` reads it, is local; one that does not parse is not. */
function isLocalUrl(value: string): boolean {
  const target = parseDatabaseUrl(value);
  return target !== null && isLocalDbHost(target.host);
}

/** Why a `MIKRO_ORM_*` connection override is refused, or null when none is set to one. */
function mikroOrmOverrideProblem(env: LocalDbGuardInput['env']): null | string {
  for (const key of MIKRO_ORM_TARGET_KEYS) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (key === 'MIKRO_ORM_HOST' && isLocalDbHost(value)) continue;
    if (key === 'MIKRO_ORM_CLIENT_URL' && isLocalUrl(value)) continue;
    // A database name has no host to check: it renames the target behind the `DB_DATABASE` this
    // guard reports, so it is refused whatever it says.
    return key;
  }
  return null;
}

/**
 * The host, port and database the scripts will connect to. Only called once `databaseUrlProblem`
 * passed, so a set `DATABASE_URL` parses. Never the credentials.
 */
function resolveTarget(env: LocalDbGuardInput['env']): { database: string; host: string; port: string; source: 'DATABASE_URL' | 'DB_*' } {
  const url = databaseUrlSetting(env);
  const parsed = url === null ? null : parseDatabaseUrl(url);
  if (parsed) return { database: parsed.database, host: parsed.host, port: parsed.port === null ? '' : String(parsed.port), source: 'DATABASE_URL' };
  return {
    database: (env['DB_DATABASE'] ?? '').trim(),
    host: (env['DB_HOST'] ?? '').trim(),
    port: (env['DB_PORT'] ?? '').trim(),
    source: 'DB_*',
  };
}
