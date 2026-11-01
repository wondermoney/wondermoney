/// <reference types="vite/client" />
/**
 * An in-process, throwaway Postgres for tests that have to assert what a query returns.
 *
 * Raw SQL, Kysely and MikroORM conditions on relations can only be judged by running them: a mocked
 * EntityManager returns whatever the test hands it, whatever the `where` says. This harness runs
 * real Postgres (PGlite, compiled to WASM) inside the test process, exposes it on a loopback port
 * through `pglite-socket`, and points a real MikroORM at it with the schema generated from the
 * entities. Nothing leaves the machine and nothing reads `.env`.
 *
 * Usage, once per test file:
 *
 *   const db = useTestDatabase();      // starts in beforeAll, truncates before each test
 *   ...db.em()                         // a fresh fork per call; also installed as `DI.em`
 *
 * Starting costs ~2-3 s (metadata discovery in a child process plus schema creation).
 *
 * The schema is generated from the entities by default. A test of something the entities do not
 * describe (an index or constraint only a migration creates) asks for
 * `useTestDatabase({ schema: 'migrations' })`: the database is then built by running the real
 * migrations, the same way a fresh install is.
 *
 * PGlite is one backend, so it cannot show two sessions contending (a lock, a race). A test of
 * that asks for `useTestDatabase({ postgresUrl: process.env.TEST_POSTGRES_URL })`: it then gets
 * its own throwaway database on that server, created on start and dropped on close, with a pool
 * of several connections. CI points `TEST_POSTGRES_URL` at its disposable service; locally the
 * variable is unset and such a test is skipped (`describe.runIf`). Never point it at a database
 * that matters: only the database the harness creates is written, but it is created there.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { type Constructor, GeneratedCacheAdapter } from '@mikro-orm/core';
import { type Migration, Migrator } from '@mikro-orm/migrations';
import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import pg, { types } from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { DI } from '@app/database/di';

const API_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface TestDatabase {
  close(): Promise<void>;
  /** A fresh EntityManager fork, so no identity-map state leaks between steps of a test. */
  em(): EntityManager;
  orm: MikroORM;
  reset(): Promise<void>;
}

let metadataCache: Record<string, unknown> | undefined;

export interface TestDatabaseOptions {
  /** A real Postgres server to create a throwaway database on, for tests of concurrent sessions. */
  postgresUrl?: string;
  /** Where the schema comes from: the entities (default) or the real migrations. */
  schema?: 'entities' | 'migrations';
}

export async function startTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  if (options.postgresUrl) return startServerDatabase(options.postgresUrl, options);
  const pglite = await PGlite.create({ extensions: { pg_trgm } });
  await pglite.exec('create extension if not exists pg_trgm');
  // PGlite is a single backend, so the pool holds one connection. Code that runs
  // `em.getConnection().execute()` inside `em.transactional()` asks the pool for a second
  // connection and waits forever; a test of such code runs the callback on the plain EM instead.
  const server = new PGLiteSocketServer({ db: pglite, host: '127.0.0.1', port: 0 });
  await server.start();
  const port = Number(server.getServerConn().split(':').pop());

  // The API parses numerics as floats at connect time (`connectDatabase`); do the same so a
  // query returns the numbers the code under test actually sees.
  types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));

  const orm = await MikroORM.init({
    allowGlobalContext: true,
    dbName: 'postgres',
    entities: entityClasses(),
    ...migrationOptions(),
    host: '127.0.0.1',
    metadataCache: { adapter: GeneratedCacheAdapter, enabled: true, options: { data: loadEntityMetadata() } },
    metadataProvider: TsMorphMetadataProvider,
    password: 'postgres',
    pool: { max: 1, min: 1 },
    port,
    user: 'postgres',
  });
  await createSchema(orm, options);

  return {
    async close() {
      await orm.close(true);
      await server.stop();
      await pglite.close();
    },
    em: () => orm.em.fork(),
    orm,
    async reset() {
      await orm.schema.clear();
    },
  };
}

async function createSchema(orm: MikroORM, options: TestDatabaseOptions) {
  if (options.schema === 'migrations') await orm.migrator.up();
  else await orm.schema.create();
}

function entityClasses(): (new (...args: never[]) => object)[] {
  const modules = import.meta.glob('../../database/entity/*.ts', { eager: true });
  return Object.values(modules).flatMap((module) => Object.values(module as Record<string, unknown>).filter((value): value is new (...args: never[]) => object => typeof value === 'function'));
}

function loadEntityMetadata(): Record<string, unknown> {
  if (metadataCache) return metadataCache;
  const dir = mkdtempSync(join(tmpdir(), 'wm-entity-metadata-'));
  try {
    execFileSync(process.execPath, ['--import=tsx', 'src/__tests__/__helpers__/generate-entity-metadata.ts', dir], { cwd: API_ROOT, stdio: 'pipe' });
    const data: Record<string, unknown> = {};
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      data[file.replace(/\.[jt]s\.json$/, '')] = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { data: unknown }).data;
    }
    metadataCache = data;
    return data;
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/** The real migrations, handed to the migrator as classes so it never loads files itself. */
function migrationOptions() {
  const modules = import.meta.glob('../../database/migrations/Migration*.ts', { eager: true });
  const migrationsList = Object.values(modules)
    .flatMap((module) => Object.entries(module as Record<string, unknown>))
    .filter((entry): entry is [string, Constructor<Migration>] => entry[0].startsWith('Migration') && typeof entry[1] === 'function')
    .map(([name, migration]) => ({ class: migration, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { extensions: [Migrator], migrations: { migrationsList, snapshot: false } };
}

/** A fresh database on a real server, with a pool of several connections, dropped on close. */
async function startServerDatabase(postgresUrl: string, options: TestDatabaseOptions): Promise<TestDatabase> {
  const server = new URL(postgresUrl);
  const dbName = `wm_test_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = async (sql: string) => {
    const client = new pg.Client({ connectionString: postgresUrl });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };
  await admin(`create database "${dbName}"`);

  types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));
  const orm = await MikroORM.init({
    allowGlobalContext: true,
    dbName,
    entities: entityClasses(),
    ...migrationOptions(),
    host: server.hostname,
    metadataCache: { adapter: GeneratedCacheAdapter, enabled: true, options: { data: loadEntityMetadata() } },
    metadataProvider: TsMorphMetadataProvider,
    password: decodeURIComponent(server.password),
    pool: { max: 8, min: 0 },
    port: Number(server.port || 5432),
    user: decodeURIComponent(server.username),
  });
  await orm.em.getConnection().execute('create extension if not exists pg_trgm');
  await createSchema(orm, options);

  return {
    async close() {
      await orm.close(true);
      await admin(`drop database if exists "${dbName}"`);
    },
    em: () => orm.em.fork(),
    orm,
    async reset() {
      await orm.schema.clear();
    },
  };
}

/** Start a database for this test file, truncate it before every test, and install it as `DI.em`. */
export function useTestDatabase(options: TestDatabaseOptions = {}): TestDatabase {
  let database: TestDatabase | undefined;
  const handle: TestDatabase = {
    close: () => database?.close() ?? Promise.resolve(),
    em: () => {
      if (!database) throw new Error('Test database is not started');
      return database.em();
    },
    get orm() {
      if (!database) throw new Error('Test database is not started');
      return database.orm;
    },
    reset: () => database?.reset() ?? Promise.resolve(),
  };

  beforeAll(async () => {
    database = await startTestDatabase(options);
  }, 60_000);
  // Truncating every table on a real server can pass the default 10 s hook timeout when the whole
  // suite runs in parallel against it.
  beforeEach(async () => {
    await handle.reset();
    DI.em = handle.em();
    DI.orm = handle.orm;
  }, 60_000);
  afterAll(async () => {
    DI.orm = null;
    await handle.close();
  });

  return handle;
}
