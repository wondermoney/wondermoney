import { pathToFileURL } from 'node:url';

import { MikroORM } from '@mikro-orm/core';
import type { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Client } from 'pg';

import { ReferenceDataSeeder } from './database/seeders/ReferenceDataSeeder.js';
import config from './mikro-orm.config.js';

/**
 * Advisory-lock key for the migration runner.
 *
 * MikroORM's Migrator wraps each migration in a transaction but does **not**
 * serialise concurrent migrators across processes: two API containers booting
 * together both read the same pending list, both start, and the loser then tries
 * to re-apply an already-applied migration (`column "x" already exists`) and
 * crash-loops. This lock makes the second process wait, then observe zero
 * pending migrations and start cleanly.
 */
const MIGRATION_LOCK_KEY = 'wondermoney:migrations';

/**
 * Migrations that must NOT be applied automatically on container startup.
 *
 * The container entrypoint is `node dist/migrate.js && exec node dist/server.js`, so every
 * pending migration runs before the API can serve — and a failure exits non-zero, which means
 * the server never starts and the deploy never completes.
 *
 * That is the right default for ordinary additive DDL. It is wrong for migrations that take a
 * heavy lock or run long:
 *
 *   - `Migration20260915190000` rewrites `transaction` and `financial_transaction` under
 *     ACCESS EXCLUSIVE, and deliberately sets `lock_timeout = '5s'` so it fails fast rather
 *     than queueing behind live traffic and then blocking it. On a busy database that lock is
 *     not available in five seconds, so it fails — and takes the whole deploy with it.
 *   - `Migration20260915190100` / `...190200` build indexes `CONCURRENTLY`. Those are online
 *     by design, but on a large table they take minutes, and every second of that is a second
 *     the API is not serving.
 *
 * Each of these documents "apply in a maintenance window" in its own docblock. This list is
 * what actually enforces it: the runner applies everything up to the first entry here, then
 * stops and reports, letting the server start on the older-but-consistent schema.
 *
 * Apply them deliberately with `pnpm migrate:manual` (or `migrate:manual:prd`), which runs the
 * same runner with `APPLY_MANUAL_MIGRATIONS=true`.
 *
 * To add one: put the class name here in the same commit that adds the migration.
 */
const MANUAL_MIGRATIONS = new Set([
  'Migration20260915190000',
  'Migration20260915190100',
  'Migration20260915190200',
]);

/**
 * The lock is taken on a dedicated `pg` client rather than through the ORM.
 *
 * `pg_advisory_lock` is **session**-scoped (not transaction-scoped — the migrator
 * opens and commits its own transactions, so `pg_advisory_xact_lock` as used in
 * the business-logic paths would release far too early). Session scope means the
 * lock and the unlock must run on the *same* connection, which a pooled ORM
 * connection cannot guarantee. A standalone client pins one session for the whole
 * run, and closing it releases the lock even if the process dies mid-migration.
 */
async function createLockClient(): Promise<Client> {
  // Read the connection details straight from the env rather than off `config`.
  // Importing `./mikro-orm.config.js` has already run `dotenv.config()`, and that
  // config object is itself built from exactly these five variables — but its
  // `password` is typed as MikroORM's dynamic-credential union, which `pg` does
  // not accept.
  const { DB_DATABASE, DB_HOST, DB_PASSWORD, DB_PORT, DB_USERNAME } = process.env;
  const client = new Client({
    database: DB_DATABASE,
    host: DB_HOST,
    password: DB_PASSWORD,
    port: DB_PORT === undefined ? undefined : Number(DB_PORT),
    user: DB_USERNAME,
  });
  await client.connect();
  return client;
}

/**
 * Decide how far to migrate.
 *
 * Pure and exported so the hold-back rule is testable without a database — the rule is the
 * thing that keeps a heavy migration from taking a deploy down, so it deserves a test.
 *
 * Returns the migration to stop at (`upTo`, `undefined` meaning "apply everything pending")
 * and the names held back.
 */
export type MigrationPlan =
  /** Apply every pending migration. */
  | { apply: 'all'; held: string[] }
  /** Apply nothing — the next pending migration is manual. */
  | { apply: 'none'; held: string[] }
  /** Apply pending migrations up to and including `upTo`, then stop. */
  | { apply: 'upTo'; held: string[]; upTo: string };

export function planMigrations(
  pending: { name: string }[],
  options: { applyManual?: boolean; freshDatabase?: boolean; manual?: ReadonlySet<string> } = {},
): MigrationPlan {
  const manual = options.manual ?? MANUAL_MIGRATIONS;
  const name = (migration: { name: string }) => migration.name.replace(/\.[jt]s$/, '');

  // A maintenance window protects live traffic and data; an empty database has neither, so a
  // fresh install gets the whole schema at once.
  if (options.applyManual || options.freshDatabase) return { apply: 'all', held: [] };

  const firstManualIndex = pending.findIndex((migration) => manual.has(name(migration)));
  if (firstManualIndex === -1) return { apply: 'all', held: [] };

  const held = pending.slice(firstManualIndex).map(name);
  if (firstManualIndex === 0) return { apply: 'none', held };
  return { apply: 'upTo', held, upTo: name(pending[firstManualIndex - 1]!) };
}

/**
 * Whether to load the reference data (currencies, categories, the asset catalog...) on this run:
 * only into a database that has none yet — a fresh install — and never when
 * `SEED_REFERENCE_DATA=false`. An existing database is never re-seeded, so this cannot duplicate
 * or overwrite anything.
 */
export function shouldSeedReferenceData(hasReferenceData: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['SEED_REFERENCE_DATA']?.trim().toLowerCase() === 'false') return false;
  return !hasReferenceData;
}

async function main() {
  const lockClient = await createLockClient();
  try {
    console.log('[migrate] acquiring advisory lock');
    await lockClient.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    console.log('[migrate] advisory lock acquired');

    const orm = await MikroORM.init<PostgreSqlDriver>(config);
    try {
      const migrator = orm.migrator;
      const pending = await migrator.getPendingMigrations();
      console.log(`[migrate] ${pending.length} pending migration(s)`);

      const executed = await migrator.getExecutedMigrations();
      const plan = planMigrations(pending, {
        applyManual: process.env['APPLY_MANUAL_MIGRATIONS'] === 'true',
        freshDatabase: executed.length === 0,
      });

      if (plan.apply !== 'none') {
        const applied = await migrator.up(plan.apply === 'upTo' ? { to: plan.upTo } : undefined);
        for (const migration of applied) {
          console.log(`[migrate] applied ${migration.name}`);
        }
      }
      const [{ present } = { present: true }] = await orm.em.getConnection().execute<{ present: boolean }[]>(
        'select exists(select 1 from currency) as present',
      );
      if (shouldSeedReferenceData(present)) {
        console.log('[migrate] empty database: loading reference data');
        await orm.seeder.seed(ReferenceDataSeeder);
        console.log('[migrate] reference data loaded');
      }
      const held = plan.held;
      if (held.length > 0) {
        console.warn(
          `[migrate] HELD BACK ${held.length} migration(s) requiring a maintenance window: ${held.join(', ')}. `
          + 'The API starts on the current schema. Apply them deliberately with `pnpm migrate:manual`.',
        );
      }
      console.log('[migrate] done');
    } finally {
      await orm.close(true);
    }
  } finally {
    try {
      await lockClient.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    } finally {
      await lockClient.end();
    }
  }
}

/**
 * Only run when this file *is* the process entrypoint.
 *
 * Without the guard, `main()` fired at module scope — so
 * `import { planMigrations } from '../migrate.js'` in a unit test started a real
 * migration run: it opened a `pg` client, tried to take the advisory lock, and
 * rejected. Whether that surfaced was a race between the rejection and the test
 * run finishing, which is why it passed locally and failed in CI (no database
 * there to fail against slowly). Vitest reported it as an Unhandled Rejection and
 * exited 1 with all 350 test files green — a failing build with nothing failing in it.
 *
 * `process.argv[1]` is the script node was given; comparing it to this module's own
 * URL distinguishes `node dist/migrate.js` (the container's CMD) from any import.
 */
const entrypoint = process.argv[1];
const isDirectRun = entrypoint !== undefined
  && import.meta.url === pathToFileURL(entrypoint).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error('[migrate] failed', err);
    process.exit(1);
  });
}
