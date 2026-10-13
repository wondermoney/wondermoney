type EnvLike = Partial<Record<string, string | undefined>>;

interface PgBossConfig {
  connectionString: string;
  migrate: boolean;
  persistWarnings: boolean;
  schedule: boolean;
  schema: string;
  supervise: boolean;
}

const parseBoolean = (name: string, value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (['1', 'on', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  throw new Error(`Invalid ${name} env value: ${value}`);
};

export const buildPgBossConfig = (env: EnvLike = process.env): PgBossConfig => {
  const host = env['DB_HOST'];
  const port = env['DB_PORT'];
  const database = env['DB_DATABASE'];
  const username = env['DB_USERNAME'];
  const password = env['DB_PASSWORD'];
  const nodeEnv = env['NODE_ENV'];

  if (!host || !port || !database || !username || !password) {
    throw new Error(`Invalid DB data in .env file for ENV ${nodeEnv ?? 'unknown'}; expected DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD`);
  }

  if (!/^\d+$/.test(port)) {
    throw new Error(`Invalid DB_PORT value: ${port}`);
  }

  const auth = password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : `${encodeURIComponent(username)}@`;

  return {
    connectionString: `postgres://${auth}${host}:${port}/${encodeURIComponent(database)}`,
    migrate: parseBoolean('PGBOSS_MIGRATE', env['PGBOSS_MIGRATE'], false),
    persistWarnings: parseBoolean('PGBOSS_PERSIST_WARNINGS', env['PGBOSS_PERSIST_WARNINGS'], true),
    schedule: parseBoolean('PGBOSS_SCHEDULE', env['PGBOSS_SCHEDULE'], false),
    schema: env['PGBOSS_SCHEMA'] ?? 'pgboss',
    supervise: parseBoolean('PGBOSS_SUPERVISE', env['PGBOSS_SUPERVISE'], true),
  };
};
