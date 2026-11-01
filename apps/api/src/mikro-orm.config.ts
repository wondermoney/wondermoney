import type { Options } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { SeedManager } from '@mikro-orm/seeder';
import { SqlHighlighter } from '@mikro-orm/sql-highlighter';

import { type ConfigurationSource, loadConfiguration } from '@app/config/configuration';

import { NamingStrategy } from './database/naming-strategy.js';
import { ExtendedEntityRepository } from './database/repositories/_ExtendedEntityRepository.js';

/**
 * The committed schema snapshot `migration:create` / `migration:check` diff entities against.
 *
 * MikroORM names the snapshot after the connected database (`.snapshot-<dbName>.json`) unless
 * this is set, so the same command against a database with a different name read and wrote a
 * different, stale file. Pinning the name keeps one snapshot regardless of `DB_DATABASE`.
 * Applying migrations must not rewrite it: the package `migrate:*` scripts set
 * `MIKRO_ORM_MIGRATIONS_SNAPSHOT=false` (CI checks the snapshot survives a fresh migrate).
 */
const MIGRATION_SNAPSHOT_NAME = '.snapshot-wmdb';

/**
 * Build a MikroORM options object from a pre-validated configuration source.
 *
 * Pure: no `process.env` reads, no `dotenv.config()` calls. The migration entrypoint and
 * the bootstrap chain both call this with a configuration produced by `loadConfiguration`,
 * keeping every database connection target behind the validated seam.
 */
export function createMikroOrmOptions(
  config: ReturnType<typeof loadConfiguration<'migration' | 'orm-cli'>>,
): Partial<Options<PostgreSqlDriver>> {
  const { database, runtime } = config;
  if (!database.connectionString && (!database.host || !database.port || !database.database || !database.username)) {
    throw new Error('MikroORM configuration is missing connection details');
  }

  const pool = {
    acquireTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: runtime.appEnv === 'test' ? 10 : runtime.appEnv === 'development' ? 20 : 20,
    min: 2,
  } as const;

  const base: Partial<Options<PostgreSqlDriver>> = {
    dbName: database.database ?? undefined,
    driver: PostgreSqlDriver,
    entityRepository: () => ExtendedEntityRepository,
    extensions: [Migrator, SeedManager],
    host: database.host ?? undefined,
    metadataProvider: TsMorphMetadataProvider,
    namingStrategy: NamingStrategy,
    password: database.password ?? undefined,
    pool: { ...pool },
    port: database.port ?? undefined,
    user: database.username ?? undefined,
  };

  if (runtime.isProduction || runtime.isStaging) {
    return {
      ...base,
      debug: runtime.shouldDebugSql,
      entities: ['./dist/database/entity/*.js'],
      entitiesTs: ['./src/database/entity/*.ts'],
      migrations: {
        allOrNothing: false,
        emit: 'js',
        path: './dist/database/migrations',
        pathTs: './src/database/migrations',
        snapshotName: MIGRATION_SNAPSHOT_NAME,
      },
      seeder: {
        defaultSeeder: 'DatabaseSeeder',
        path: './dist/database/seeders',
        pathTs: './src/database/seeders',
      },
    };
  }

  if (runtime.appEnv === 'development' || runtime.appEnv === 'test') {
    return {
      ...base,
      debug: runtime.shouldDebugSql,
      entities: ['./dist/database/entity'],
      entitiesTs: ['./src/database/entity'],
      highlighter: new SqlHighlighter(),
      migrations: { allOrNothing: false, pathTs: './src/database/migrations', snapshotName: MIGRATION_SNAPSHOT_NAME },
      preferTs: true,
      seeder: { defaultSeeder: 'DatabaseSeeder', pathTs: './src/database/seeders' },
    };
  }

  throw new Error(`Invalid runtime ${runtime.appEnv}`);
}

/**
 * Legacy default export for tooling that imports `mikro-orm.config.ts` directly (the MikroORM
 * CLI and a number of database scripts). Validates lazily at access time so test environments
 * that lack secrets are not blocked at import; the validated Configuration module is the only
 * reader of `process.env`.
 *
 * The proxy must forward *every* object operation, not just `get`: `MikroORM.init` merges its
 * options with `Object.entries`, so a get-only proxy over `{}` enumerates as empty and MikroORM
 * boots with no connection config at all (the staging deploy crash-loop this replaced).
 */
let resolvedOptions: Partial<Options<PostgreSqlDriver>> | undefined;
function resolveOptions(): Partial<Options<PostgreSqlDriver>> {
  if (!resolvedOptions) {
    const source: ConfigurationSource = Object.freeze({ ...(process.env as Record<string, string | undefined>) });
    resolvedOptions = createMikroOrmOptions(loadConfiguration('orm-cli', source));
  }
  return resolvedOptions;
}

const mikroOrmOptions: Partial<Options<PostgreSqlDriver>> = new Proxy({}, {
  defineProperty: (_target, prop, descriptor) => Reflect.defineProperty(resolveOptions(), prop, descriptor),
  deleteProperty: (_target, prop) => Reflect.deleteProperty(resolveOptions(), prop),
  get: (_target, prop): unknown => Reflect.get(resolveOptions(), prop),
  getOwnPropertyDescriptor: (_target, prop) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(resolveOptions(), prop);
    // A proxy may only report a property absent from its own target as configurable.
    return descriptor && { ...descriptor, configurable: true };
  },
  has: (_target, prop) => Reflect.has(resolveOptions(), prop),
  ownKeys: () => Reflect.ownKeys(resolveOptions()),
  set: (_target, prop, value) => Reflect.set(resolveOptions(), prop, value),
});

export default mikroOrmOptions;
