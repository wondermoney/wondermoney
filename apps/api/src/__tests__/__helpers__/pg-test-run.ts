/**
 * The test databases on the shared test Postgres (`TEST_POSTGRES_URL`): who owns them, and the
 * clean-up of the ones left by runs that died.
 *
 * Several runs share one server: agents in parallel worktrees, a developer's watch mode, CI. There
 * are two kinds of database, and neither can collide:
 *
 * - **Templates** (`wm_tpl_<schema>_<hash>`) hold a built schema. The name is a hash of
 *   everything the schema is built from, so two runs that agree on the name agree on the contents,
 *   and any run may use one another built. Nobody connects to a template; it is only copied. One
 *   unused for a day (a schema that has since changed) is swept.
 * - **A test file's database** (`<prefix>_<pid>_<time>_<random>`) belongs to the run that created
 *   it: `<pid>_<time>` is the run's id, its main process and start time. The prefix is
 *   `WM_TEST_DB_PREFIX` (default `wm_test`), set per worktree, so a worktree's leftovers can be
 *   found by prefix (`scripts/scratch-db.mjs drop-all`). The run holds one connection open for as
 *   long as it lives, named `wm-test-run:<run id>` (`application_name`); a run whose connection is
 *   gone has ended, however it ended, so its databases can go. Each run sweeps those under its own
 *   prefix when it starts, and drops its own when it ends.
 *
 * Templates are guarded by an advisory lock on their name: shared while a file copies one,
 * exclusive while one is built or swept, so a template never disappears under a copy.
 *
 * This file is the vitest `globalSetup` of the projects whose tests use the server
 * (`vitest.config.ts`); `pg-test-db.ts` creates the databases. Never point `TEST_POSTGRES_URL` at a
 * server that matters: the sweep drops any database under its prefix that it finds abandoned.
 */
import { randomBytes } from 'node:crypto';

import pg from 'pg';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run that owns this run's test databases on `url`, or null when no server is configured. */
    wmTestRun: null | TestRun;
  }
}

export interface TestRun {
  /** `<pid>_<start time>` of the run's main process. */
  id: string;
  /** `WM_TEST_DB_PREFIX`, which every file database of the run starts with. */
  prefix: string;
  url: string;
}

const RUN_APPLICATION_PREFIX = 'wm-test-run:';
const TEMPLATE_PREFIX = 'wm_tpl_';
/** `<pid>_<epoch ms>` and an 8-digit hex suffix: at most 1 + 7 + 1 + 13 + 1 + 8 characters. */
const RUN_SUFFIX = String.raw`_(\d+_\d{13})_[0-9a-f]{8}`;
/** What the harness named its databases before runs were (`wm_test_<worker pid>_<epoch ms>_<decimal random>`). */
const LEGACY_DATABASE = /^wm_test_\d+_(\d{13})_\d{1,6}$/;
/** Room for `RUN_SUFFIX` in Postgres's 63-character names. */
const MAX_PREFIX_LENGTH = 63 - 31;
/** Far longer than any test file lives, so an old-style database this old was abandoned. */
const LEGACY_MAX_AGE_MS = 60 * 60_000;
/** A template is touched whenever it is copied (at most hourly); one idle this long is stale. */
const TEMPLATE_MAX_IDLE_MS = 24 * 60 * 60_000;
const TEMPLATE_TOUCH_INTERVAL_MS = 60 * 60_000;

/** `WM_TEST_DB_PREFIX`, checked: a lower-case Postgres name short enough to leave room for the rest. */
export function testDatabasePrefix(): string {
  const prefix = process.env['WM_TEST_DB_PREFIX'] || 'wm_test';
  if (!/^[a-z_][a-z0-9_]*$/.test(prefix) || prefix.length > MAX_PREFIX_LENGTH) {
    throw new Error(`WM_TEST_DB_PREFIX must be lower-case letters, digits and underscores, at most ${MAX_PREFIX_LENGTH} characters: ${JSON.stringify(prefix)}`);
  }
  return prefix;
}

const runPrefix = (run: Pick<TestRun, 'id' | 'prefix'>) => `${run.prefix}_${run.id}_`;

/** The template for one schema source, named after the hash of what the schema is built from. */
export const templateDatabaseName = (schema: string, hash: string) => `${TEMPLATE_PREFIX}${schema}_${hash}`;

/** A test file's own database. */
export const fileDatabaseName = (run: Pick<TestRun, 'id' | 'prefix'>) => `${runPrefix(run)}${randomBytes(4).toString('hex')}`;

export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

const connect = async (url: string, applicationName = 'wm-test-admin') => {
  const client = new pg.Client({ application_name: applicationName, connectionString: url, keepAlive: true });
  // A lost connection must not crash a test worker; the query in flight fails instead.
  client.on('error', () => undefined);
  await client.connect();
  return client;
};

/** A short-lived connection to the server's maintenance database (the one the URL names). */
export async function withAdminClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect(url);
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Drop a test database, closing any session still on it. A plain DROP waits up to 5 s for such
 * sessions and then fails, which under load is what made teardown time out. A template has to stop
 * being one before it can go.
 */
export async function dropTestDatabase(client: pg.Client, name: string): Promise<void> {
  const { rows } = await client.query<{ datistemplate: boolean }>('select datistemplate from pg_database where datname = $1', [name]);
  if (!rows[0]) return;
  if (rows[0].datistemplate) await client.query(`alter database ${quoteIdent(name)} with is_template false`);
  await client.query(`drop database if exists ${quoteIdent(name)} with (force)`);
}

/**
 * Send the DROP for a test file's database and return without waiting for it. Postgres forces a
 * checkpoint for every DROP DATABASE, which takes seconds on a busy server; the server finishes the
 * drop on its own, and the run's teardown (or the next run's sweep) catches one that never arrived.
 */
export async function dropTestDatabaseInBackground(url: string, name: string): Promise<void> {
  const client = await connect(url);
  void client
    .query(`drop database if exists ${quoteIdent(name)} with (force)`)
    .catch(() => undefined)
    .finally(() => client.end().catch(() => undefined));
}

/**
 * Copy a template into a new database, building the template first if no run has. Several workers
 * (and runs) can ask at once: one builds while the rest wait, then all copy.
 */
export async function cloneTemplate(url: string, template: string, database: string, build: (url: string, template: string) => Promise<void>): Promise<void> {
  await withAdminClient(url, async (client) => {
    for (let attempt = 0; ; attempt++) {
      await client.query('select pg_advisory_lock_shared(hashtext($1))', [template]);
      try {
        const { rows } = await client.query<{ datistemplate: boolean; touched: null | string }>(
          `select datistemplate, shobj_description(oid, 'pg_database') as touched from pg_database where datname = $1`,
          [template],
        );
        if (rows[0]?.datistemplate) {
          await client.query(`create database ${quoteIdent(database)} template ${quoteIdent(template)}`);
          if (!(Date.now() - Number(rows[0].touched ?? 0) < TEMPLATE_TOUCH_INTERVAL_MS)) await client.query(`comment on database ${quoteIdent(template)} is '${Date.now()}'`);
          return;
        }
      } finally {
        await client.query('select pg_advisory_unlock_shared(hashtext($1))', [template]);
      }
      if (attempt > 0) throw new Error(`Test database template ${template} was not built`);
      await client.query('select pg_advisory_lock(hashtext($1))', [template]);
      try {
        const { rows } = await client.query<{ datistemplate: boolean }>('select datistemplate from pg_database where datname = $1', [template]);
        if (!rows[0]?.datistemplate) {
          // Left half-built by a worker that died while building it.
          if (rows[0]) await dropTestDatabase(client, template);
          await client.query(`create database ${quoteIdent(template)}`);
          await build(url, template);
          // Nobody may connect to it from now on: a single session would stop it being copied.
          await client.query(`alter database ${quoteIdent(template)} with is_template true allow_connections false`);
          await client.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [template]);
          await client.query(`comment on database ${quoteIdent(template)} is '${Date.now()}'`);
        }
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [template]);
      }
    }
  });
}

/**
 * Drop every database under `prefix` whose run has ended, and every template idle for a day.
 * Another prefix (another worktree) is left alone, and so is any run that is still alive. Returns
 * the names dropped.
 */
export async function sweepAbandonedDatabases(client: pg.Client, prefix: string, ownRunId?: string): Promise<string[]> {
  const runDatabase = new RegExp(`^${prefix}${RUN_SUFFIX}$`);
  // Databases first, live runs second: a run that starts in between owns no database yet.
  const databases = (await client.query<{ datname: string; touched: null | string }>(
    String.raw`select datname, shobj_description(oid, 'pg_database') as touched from pg_database where starts_with(datname, $1) or starts_with(datname, $2)`,
    [`${prefix}_`, TEMPLATE_PREFIX],
  )).rows;
  const live = new Set(
    (await client.query<{ name: string }>(`select substr(application_name, ${RUN_APPLICATION_PREFIX.length + 1}) as name from pg_stat_activity where application_name like '${RUN_APPLICATION_PREFIX}%'`)).rows.map((row) => row.name),
  );
  const dropped: string[] = [];
  for (const { datname: name, touched } of databases) {
    try {
      if (name.startsWith(TEMPLATE_PREFIX)) {
        if (Date.now() - Number(touched ?? 0) < TEMPLATE_MAX_IDLE_MS) continue;
        const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock(hashtext($1)) as locked', [name]);
        // Being copied or built right now, so not stale after all.
        if (!rows[0]?.locked) continue;
        try {
          await dropTestDatabase(client, name);
        } finally {
          await client.query('select pg_advisory_unlock(hashtext($1))', [name]);
        }
      } else {
        const run = runDatabase.exec(name)?.[1];
        const legacyCreatedAt = prefix === 'wm_test' ? LEGACY_DATABASE.exec(name)?.[1] : undefined;
        const abandoned = run !== undefined ? run !== ownRunId && !live.has(run) : legacyCreatedAt !== undefined && Date.now() - Number(legacyCreatedAt) > LEGACY_MAX_AGE_MS;
        if (!abandoned) continue;
        await dropTestDatabase(client, name);
      }
      dropped.push(name);
    } catch {
      // Another run's sweep got there first, or it is busy; the next sweep tries again.
    }
  }
  return dropped;
}

/** Drop what is left of a run's file databases, side by side, so their checkpoints overlap. */
async function dropRunDatabases(client: pg.Client, run: TestRun) {
  const { rows } = await client.query<{ datname: string }>('select datname from pg_database where starts_with(datname, $1)', [runPrefix(run)]);
  await Promise.all(rows.map(({ datname }) => withAdminClient(run.url, (admin) => dropTestDatabase(admin, datname)).catch(() => undefined)));
}

/**
 * vitest `globalSetup`: claim a run on `TEST_POSTGRES_URL`, sweep what dead runs left, and hand the
 * run to the test workers (`inject('wmTestRun')`). The teardown drops the file databases the run
 * still has; templates stay for the next run.
 */
/** The part of vitest's `TestProject` this needs; importing the type from `vitest/node` pulls vite's DOM-flavoured globals into the API's type-check. */
interface ProvidingProject {
  provide(key: 'wmTestRun', value: null | TestRun): void;
}

export default async function setup(project: ProvidingProject): Promise<(() => Promise<void>) | undefined> {
  const url = process.env['TEST_POSTGRES_URL'];
  if (!url) {
    project.provide('wmTestRun', null);
    return undefined;
  }
  const run: TestRun = { id: `${process.pid}_${Date.now()}`, prefix: testDatabasePrefix(), url };
  const client = await connect(url, `${RUN_APPLICATION_PREFIX}${run.id}`);
  const dropped = await sweepAbandonedDatabases(client, run.prefix, run.id);
  if (dropped.length > 0) console.info(`[pg-test-run] dropped ${dropped.length} test database(s) left by earlier runs`);
  project.provide('wmTestRun', run);

  return async () => {
    try {
      await dropRunDatabases(client, run);
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
