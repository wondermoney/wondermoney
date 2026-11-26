/**
 * Which database a process connects to: the one rule the configuration (and through it MikroORM),
 * the migration lock client, pg-boss, better-auth and the local-database guard share.
 *
 * The database is given one of two ways, never both:
 *
 *   - `DATABASE_URL`, a `postgres://` or `postgresql://` URL with a host and a database name. Its
 *     query string (`?sslmode=require`) reaches `pg` unchanged.
 *   - `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD`.
 *
 * `DATABASE_URL` beside any `DB_*` setting is refused rather than one quietly winning: before
 * `DATABASE_URL` was honoured, every connection used `DB_*`, so letting the URL win would move an
 * install that sets both to another database without a word. An empty value counts as unset
 * (docker compose passes `KEY=` from `.env` through as "").
 *
 * Messages never include the URL: it carries the password.
 *
 * Plain TypeScript with no imports, so `scripts/assert-local-db.mjs` can load it (through
 * `local-db-guard.ts`) under Node's type stripping.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const DB_SETTING_KEYS = ['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'] as const;

export interface DatabaseUrlTarget {
  readonly database: string;
  readonly host: string;
  readonly port: null | number;
}

const INVALID_URL = 'DATABASE_URL must be a postgres:// or postgresql:// URL with a host and a database name, '
  + 'such as postgres://wondermoney:<password>@db.example.com:5432/wondermoney';

/** The host, port and database a `DATABASE_URL` names, or null when it is not one we accept. */
export function parseDatabaseUrl(value: string): DatabaseUrlTarget | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
  let host: string;
  let database: string;
  try {
    host = decodeURIComponent(url.hostname).replace(/^\[(.*)\]$/u, '$1');
    database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  } catch {
    return null;
  }
  // A host given only as `?host=` (a Unix socket) is not accepted: the guard could not check it.
  if (host === '' || database === '' || database.includes('/')) return null;
  return { database, host, port: url.port === '' ? null : Number(url.port) };
}

/** `DATABASE_URL`, trimmed, or null when it is unset or empty. */
export function databaseUrlSetting(env: Env): null | string {
  const value = env['DATABASE_URL']?.trim();
  return value ? value : null;
}

/** The `DB_*` settings that hold a value. */
export interface DatabaseUrlProblem {
  readonly code: 'conflict' | 'invalid-format';
  readonly message: string;
}

export function dbSettingsSet(env: Env): string[] {
  return DB_SETTING_KEYS.filter((key) => (env[key]?.trim() ?? '') !== '');
}

/**
 * What is wrong with how `env` gives `DATABASE_URL`: set beside `DB_*`, or not a URL we accept.
 * Null when `DATABASE_URL` is unset or fine. Whether the `DB_*` set is complete is the reader's own
 * check.
 */
export function databaseUrlProblem(env: Env): DatabaseUrlProblem | null {
  const url = databaseUrlSetting(env);
  if (url === null) return null;
  const alongside = dbSettingsSet(env);
  if (alongside.length > 0) {
    return {
      code: 'conflict',
      message: `DATABASE_URL and ${alongside.join(', ')} are both set. Give the database one way: `
        + 'DATABASE_URL alone, or DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME and DB_PASSWORD without it',
    };
  }
  if (parseDatabaseUrl(url) === null) return { code: 'invalid-format', message: INVALID_URL };
  return null;
}

/**
 * The `DATABASE_URL` connection string for a reader that builds its own `pg` connection (pg-boss,
 * better-auth): null when the database is given as `DB_*`, and an error when `DATABASE_URL` is
 * set beside them or malformed.
 */
export function databaseUrlOrThrow(env: Env): null | string {
  const problem = databaseUrlProblem(env);
  if (problem) throw new Error(problem.message);
  return databaseUrlSetting(env);
}
