/**
 * The decision behind `scripts/assert-local-db.mjs`: may a `package.json` database script run
 * against the target the environment resolves to? The script loads `.env` (`loadDotenv`), calls
 * this, prints the message and exits with its status. The header of that script explains the
 * two tiers and the limits of a host-only check.
 *
 * Plain TypeScript with no imports, so the script can import it under Node's type stripping.
 *
 * `DATABASE_URL` is not read here: a target given only by it has no `DB_HOST`, so the guard
 * refuses it as unverifiable, which fails closed.
 */

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

/** Why a `MIKRO_ORM_*` connection override is refused, or null when none is set to one. */
export function checkLocalDbTarget({ command, env, optIn }: LocalDbGuardInput): LocalDbGuardResult {
  const host = (env['DB_HOST'] ?? '').trim();
  const port = (env['DB_PORT'] ?? '').trim();
  const database = (env['DB_DATABASE'] ?? '').trim();
  const target = `    DB_HOST     ${host}\n    DB_PORT     ${port || '(unset)'}\n    DB_DATABASE ${database || '(unset)'}\n`;

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
    return { allowed: true, level: 'ok', message: `✔ ${command}: target is local (DB_HOST=${host}, DB_DATABASE=${database || '(unset)'}).` };
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

function isLocalUrl(value: string): boolean {
  try {
    return isLocalDbHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

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
