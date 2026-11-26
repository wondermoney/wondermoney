/**
 * Which database a process connects to: the one rule the configuration (and through it MikroORM),
 * the migration lock client, pg-boss, better-auth and the local-database guard share.
 *
 * The database is given one of two ways, never both:
 *
 *   - `DATABASE_URL`, a `postgres://` or `postgresql://` URL with a host and a database name. Its
 *     TLS settings (`?sslmode=require`) reach `pg` unchanged.
 *   - `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD`.
 *
 * `DATABASE_URL` beside any `DB_*` setting is refused rather than one quietly winning: before
 * `DATABASE_URL` was honoured, every connection used `DB_*`, so letting the URL win would move an
 * install that sets both to another database without a word. An empty value counts as unset
 * (docker compose passes `KEY=` from `.env` through as "").
 *
 * The target is read with `pg-connection-string`'s `parse`, the parser `pg` itself applies to a
 * connection string, so what the guard checks and what `pg` connects to cannot differ. `pg` lets
 * query parameters replace the URL's own fields (`?host=` the host, `?options=` the server
 * options better-auth sets its `search_path` with), so a URL with any of those is refused. So is
 * one `pg` would read differently from how it looks (a stray `%` makes `parse` re-encode the whole
 * string), and any `#`.
 *
 * Messages never include the URL or a parameter's value: either can carry the password.
 *
 * Plain TypeScript importing only a package, so `scripts/assert-local-db.mjs` can load it (through
 * `local-db-guard.ts`) under Node's type stripping.
 */
import { parse } from 'pg-connection-string';

type Env = Readonly<Record<string, string | undefined>>;

export const DB_SETTING_KEYS = ['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'] as const;

/** Query parameters `pg` (or libpq, for `hostaddr`) would let replace what the URL itself names. */
const OVERRIDING_PARAMETERS = ['host', 'hostaddr', 'port', 'user', 'password', 'options'] as const;

export interface DatabaseUrlProblem {
  readonly code: 'conflict' | 'invalid-format';
  readonly message: string;
}

export interface DatabaseUrlTarget {
  readonly database: string;
  readonly host: string;
  readonly port: null | number;
  readonly username: null | string;
}

type Inspection = { readonly ok: false; readonly problem: string } | { readonly ok: true; readonly target: DatabaseUrlTarget };

const INVALID_URL = 'DATABASE_URL must be a postgres:// or postgresql:// URL with a host and a database name, '
  + 'such as postgres://wondermoney:<password>@db.example.com:5432/wondermoney';

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
  const inspection = inspectDatabaseUrl(url);
  return inspection.ok ? null : { code: 'invalid-format', message: inspection.problem };
}

/**
 * The `DATABASE_URL` connection string for a reader that builds its own `pg` connection (pg-boss,
 * better-auth): null when the database is given as `DB_*`, and an error when `DATABASE_URL` is
 * set beside them or not one we accept.
 */
export function databaseUrlOrThrow(env: Env): null | string {
  const problem = databaseUrlProblem(env);
  if (problem) throw new Error(problem.message);
  return databaseUrlSetting(env);
}

/** `DATABASE_URL`, trimmed, or null when it is unset or empty. */
export function databaseUrlSetting(env: Env): null | string {
  const value = env['DATABASE_URL']?.trim();
  return value ? value : null;
}

/** The `DB_*` settings that hold a value. */
export function dbSettingsSet(env: Env): string[] {
  return DB_SETTING_KEYS.filter((key) => (env[key]?.trim() ?? '') !== '');
}

/** The target a `DATABASE_URL` names, as `pg` reads it, or null when it is not one we accept. */
export function parseDatabaseUrl(value: string): DatabaseUrlTarget | null {
  const inspection = inspectDatabaseUrl(value);
  return inspection.ok ? inspection.target : null;
}

function inspectDatabaseUrl(raw: string): Inspection {
  const value = raw.trim();
  // `parse` resolves anything else against a placeholder host, so the scheme is checked first.
  if (!/^postgres(?:ql)?:\/\//iu.test(value)) return { ok: false, problem: INVALID_URL };

  const overriding = queryParameters(value).find((key) => (OVERRIDING_PARAMETERS as readonly string[]).includes(key.toLowerCase()));
  if (overriding !== undefined) {
    return {
      ok: false,
      problem: `DATABASE_URL sets ${overriding} in its query string, which would replace what the URL itself names. `
        + 'Give the host, port, user and password in the URL before the ?, and no options parameter',
    };
  }

  // A `#` starts a fragment `pg` still feeds to its parser, where a stray `%` changes how the whole
  // URL is decoded. A `#` in a password is written `%23`.
  if (value.includes('#')) {
    return { ok: false, problem: 'DATABASE_URL must not contain #. Write a # in the password as %23' };
  }

  // `asGiven` is what `pg` reads: this exact string. A stray `%` anywhere in it makes `parse`
  // re-encode the whole URL, which changes the host it decodes (`%6cocalhost` stays as written),
  // so the copies with the query trimmed must agree with it, or the URL is refused.
  let asGiven: ReturnType<typeof parse>;
  try {
    asGiven = parse(value);
  } catch (error) {
    // It reads the TLS files the URL names (sslrootcert...), as `pg` does when it connects.
    const tlsFile = error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('E');
    return { ok: false, problem: tlsFile ? 'DATABASE_URL names a TLS file (sslcert, sslkey or sslrootcert) that cannot be read' : INVALID_URL };
  }
  let withoutTlsFiles: ReturnType<typeof parse>;
  let withoutQuery: ReturnType<typeof parse>;
  try {
    withoutTlsFiles = parse(stripQuery(value, (key) => !key.toLowerCase().startsWith('ssl')));
    withoutQuery = parse(stripQuery(value, () => false));
  } catch {
    return { ok: false, problem: INVALID_URL };
  }

  // Belt and braces for an encoding the parameter check above did not foresee: the query must not
  // change where `pg` connects, or who as.
  for (const field of ['host', 'port', 'user', 'password'] as const) {
    const given = asGiven[field] ?? '';
    if (given !== (withoutTlsFiles[field] ?? '') || given !== (withoutQuery[field] ?? '')) {
      return { ok: false, problem: `DATABASE_URL is written so that pg would read its ${field} differently from how it looks. Percent-encode only what needs it` };
    }
  }

  // An empty host is a Unix socket: the guard cannot tell where that is, so it is not accepted.
  const host = asGiven.host ?? '';
  const database = asGiven.database ?? '';
  if (host === '' || database === '') return { ok: false, problem: INVALID_URL };
  const port = asGiven.port ? Number(asGiven.port) : null;
  if (port !== null && !Number.isInteger(port)) return { ok: false, problem: INVALID_URL };
  return { ok: true, target: { database, host, port, username: asGiven.user ? asGiven.user : null } };
}

/** The query parameter names, decoded as URL parsing decodes them. */
function queryParameters(value: string): string[] {
  const beforeFragment = value.split('#', 1)[0] ?? '';
  const at = beforeFragment.indexOf('?');
  return at === -1 ? [] : [...new URLSearchParams(beforeFragment.slice(at + 1)).keys()];
}

/** `value` with only the query parameters `keep` accepts. */
function stripQuery(value: string, keep: (key: string) => boolean): string {
  const beforeFragment = value.split('#', 1)[0] ?? '';
  const at = beforeFragment.indexOf('?');
  if (at === -1) return beforeFragment;
  const kept = new URLSearchParams([...new URLSearchParams(beforeFragment.slice(at + 1))].filter(([key]) => keep(key)));
  const query = kept.toString();
  return query === '' ? beforeFragment.slice(0, at) : `${beforeFragment.slice(0, at)}?${query}`;
}
