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
 *   const db = useTestDatabase();      // starts in beforeAll, empties every table before each test
 *   ...db.em()                         // a fresh fork per call; also installed as `DI.em`
 *
 * Every test file gets its own PGlite instance; nothing is shared between files. What is shared is
 * the work of building one: the entity metadata (ts-morph discovery in a child process, ~2 s) and
 * the schema are built once and kept under `node_modules/.cache/wm-test-db`, keyed by a hash of the
 * entities, the migrations, this harness and the lockfile, so a later file (or run) restores a copy
 * of the built data directory in ~0.1 s instead of rebuilding it. Change an entity and the hash
 * changes; nothing goes stale.
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
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { type Constructor, GeneratedCacheAdapter } from '@mikro-orm/core';
import { type Migration, Migrator } from '@mikro-orm/migrations';
import { type EntityManager, MikroORM, type Options } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import pg, { types } from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { DI } from '@app/database/di';

const API_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CACHE_DIR = join(API_ROOT, 'node_modules/.cache/wm-test-db');

export interface TestDatabase {
  close(): Promise<void>;
  /** A fresh EntityManager fork, so no identity-map state leaks between steps of a test. */
  em(): EntityManager;
  orm: MikroORM;
  /** Empties every entity table and restarts their sequences, as a TRUNCATE ... RESTART IDENTITY would. */
  reset(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** A real Postgres server to create a throwaway database on, for tests of concurrent sessions. */
  postgresUrl?: string;
  /** Where the schema comes from: the entities (default) or the real migrations. */
  schema?: 'entities' | 'migrations';
}

type SchemaSource = NonNullable<TestDatabaseOptions['schema']>;

export async function startTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  if (options.postgresUrl) return startServerDatabase(options.postgresUrl, options);
  const template = await schemaTemplate(options.schema ?? 'entities');
  const pglite = await PGlite.create({ extensions: { pg_trgm }, loadDataDir: new Blob([new Uint8Array(template)]) });
  const { orm, stop } = await connectOrm(pglite);
  const reset = await resetter(orm);

  return {
    async close() {
      await orm.close(true);
      await stop();
    },
    em: () => orm.em.fork(),
    orm,
    reset,
  };
}

/**
 * Serve a PGlite instance on a loopback port and point a MikroORM at it. PGlite is a single
 * backend, so the pool holds one connection. Code that runs `em.getConnection().execute()` inside
 * `em.transactional()` asks the pool for a second connection and waits forever; a test of such
 * code runs the callback on the plain EM instead.
 */
async function connectOrm(pglite: PGlite) {
  const server = new PGLiteSocketServer({ db: pglite, host: '127.0.0.1', port: 0 });
  await server.start();
  const port = Number(server.getServerConn().split(':').pop());
  const orm = await MikroORM.init({ ...ormOptions(), dbName: 'postgres', host: '127.0.0.1', password: 'postgres', pool: { max: 1, min: 1 }, port, user: 'postgres' });
  return {
    orm,
    stop: async () => {
      await server.stop();
      await pglite.close();
    },
  };
}

async function createSchema(orm: MikroORM, schema: SchemaSource) {
  if (schema === 'migrations') await orm.migrator.up();
  else await orm.schema.create();
}

function ormOptions(): Options {
  // The API parses numerics as floats at connect time (`connectDatabase`); do the same so a
  // query returns the numbers the code under test actually sees.
  types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));
  return {
    allowGlobalContext: true,
    entities: entityClasses(),
    ...migrationOptions(),
    metadataCache: { adapter: GeneratedCacheAdapter, enabled: true, options: { data: entityMetadata() } },
    metadataProvider: TsMorphMetadataProvider,
  };
}

/** A PGlite data directory with the schema already built, made once per source hash. */
async function schemaTemplate(schema: SchemaSource): Promise<Buffer> {
  return cached(`schema-${schema}`, hashOf(['entity', 'migrations', 'harness', 'lockfile']), 'tar', async () => {
    const pglite = await PGlite.create({ extensions: { pg_trgm } });
    await pglite.exec('create extension if not exists pg_trgm');
    const { orm, stop } = await connectOrm(pglite);
    try {
      await createSchema(orm, schema);
    } finally {
      await orm.close(true);
    }
    const dump = await pglite.dumpDataDir('none');
    await stop();
    return Buffer.from(await dump.arrayBuffer());
  });
}

/**
 * A reset that runs as one round trip. MikroORM's `schema.clear()` sends a separate
 * `TRUNCATE ... CASCADE` for each of ~80 tables, which costs a quarter of a second or more before
 * every test. Deleting from the same tables with foreign-key triggers off, then restarting the
 * sequences they own, leaves the database in the same state (empty tables, keys from 1) in a few
 * milliseconds. Both servers this runs on (PGlite and CI's disposable Postgres) connect as a
 * superuser, which `session_replication_role` requires.
 */
async function resetter(orm: MikroORM): Promise<() => Promise<void>> {
  const connection = orm.em.getConnection();
  const literals = entityTables(orm).map((table) => `'${table.replaceAll("'", "''")}'`);
  const tables = (await connection.execute<{ name: string }[]>(`select t::regclass::text as name from unnest(array[${literals.join(', ')}]::text[]) as t where to_regclass(t) is not null`)).map((row) => row.name);
  const sequences = (await connection.execute<{ name: string }[]>(`
    select distinct s.oid::regclass::text as name
    from pg_class s
    join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
    where s.relkind = 'S' and d.refobjid = any(array[${literals.join(', ')}]::regclass[])
  `)).map((row) => row.name);
  const sql = ['begin', 'set local session_replication_role = replica', ...tables.map((table) => `delete from ${table}`), ...sequences.map((sequence) => `alter sequence ${sequence} restart`), 'commit'].join(';\n');

  return async () => {
    await connection.execute(sql);
    orm.em.clear();
  };
}

/** The tables `schema.clear()` would truncate: every root entity table that is not a view. */
function entityClasses(): (new (...args: never[]) => object)[] {
  const modules = import.meta.glob('../../database/entity/*.ts', { eager: true });
  return Object.values(modules).flatMap((module) => Object.values(module as Record<string, unknown>).filter((value): value is new (...args: never[]) => object => typeof value === 'function'));
}

function entityTables(orm: MikroORM): string[] {
  const defaultSchema = orm.config.get('schema') ?? orm.em.getPlatform().getDefaultSchemaName() ?? 'public';
  return [...orm.getMetadata().getAll().values()]
    .filter((meta) => (meta.root.class === meta.class || (meta.inheritanceType === 'tpt' && meta.tptParent)) && !meta.embeddable && !meta.virtual && !meta.view && meta.tableName)
    .map((meta) => `"${meta.schema && meta.schema !== '*' ? meta.schema : defaultSchema}"."${meta.tableName}"`);
}

let metadataInProcess: Record<string, unknown> | undefined;

/**
 * MikroORM's per-entity metadata, discovered with ts-morph in a child process
 * (`generate-entity-metadata.ts` says why it cannot run here) and cached by entity source hash.
 */
function entityMetadata(): Record<string, unknown> {
  metadataInProcess ??= JSON.parse(cachedSync('entity-metadata', hashOf(['entity', 'harness', 'lockfile']), 'json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-entity-metadata-'));
    try {
      execFileSync(process.execPath, ['--import=tsx', 'src/__tests__/__helpers__/generate-entity-metadata.ts', dir], { cwd: API_ROOT, stdio: 'pipe' });
      const data: Record<string, unknown> = {};
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        data[file.replace(/\.[jt]s\.json$/, '')] = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { data: unknown }).data;
      }
      return Buffer.from(JSON.stringify(data));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }).toString('utf8')) as Record<string, unknown>;
  return metadataInProcess;
}

const HASH_INPUTS = {
  entity: () => sourceFiles('src/database/entity'),
  harness: () => [join(API_ROOT, 'src/__tests__/__helpers__/pg-test-db.ts'), join(API_ROOT, 'src/__tests__/__helpers__/generate-entity-metadata.ts')],
  lockfile: () => [join(API_ROOT, '../../pnpm-lock.yaml')],
  migrations: () => sourceFiles('src/database/migrations'),
};

function hashOf(inputs: (keyof typeof HASH_INPUTS)[]): string {
  const hash = createHash('sha256');
  for (const file of inputs.flatMap((input) => HASH_INPUTS[input]())) {
    hash.update(file);
    if (existsSync(file)) hash.update(readFileSync(file));
  }
  return hash.digest('hex').slice(0, 16);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(API_ROOT, dir)).filter((file) => file.endsWith('.ts')).sort().map((file) => join(API_ROOT, dir, file));
}

/**
 * Build `name-hash.ext` once, however many test workers ask for it at the same time: the first to
 * create the lock file builds it and renames it into place; the rest wait for it to appear. A lock
 * left by a killed run goes stale after two minutes. Older builds of the same name are pruned.
 */
async function cached(name: string, hash: string, ext: string, build: () => Promise<Buffer>): Promise<Buffer> {
  const file = join(CACHE_DIR, `${name}-${hash}.${ext}`);
  const lock = `${file}.lock`;
  mkdirSync(CACHE_DIR, { recursive: true });
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    if (existsSync(file)) return readFileSync(file);
    const fd = tryLock(lock);
    if (fd !== undefined) {
      try {
        if (existsSync(file)) return readFileSync(file);
        const data = await build();
        publish(name, file, data);
        return data;
      } finally {
        closeSync(fd);
        rmSync(lock, { force: true });
      }
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for another test worker to build ${file}`);
    await sleep(100);
  }
}

/** `cached` for a build that is synchronous (the metadata child process), so ORM options stay sync. */
function cachedSync(name: string, hash: string, ext: string, build: () => Buffer): Buffer {
  const file = join(CACHE_DIR, `${name}-${hash}.${ext}`);
  const lock = `${file}.lock`;
  mkdirSync(CACHE_DIR, { recursive: true });
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    if (existsSync(file)) return readFileSync(file);
    const fd = tryLock(lock);
    if (fd !== undefined) {
      try {
        if (existsSync(file)) return readFileSync(file);
        const data = build();
        publish(name, file, data);
        return data;
      } finally {
        closeSync(fd);
        rmSync(lock, { force: true });
      }
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for another test worker to build ${file}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

function publish(name: string, file: string, data: Buffer) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
  for (const entry of readdirSync(CACHE_DIR)) {
    const path = join(CACHE_DIR, entry);
    if (path !== file && entry.startsWith(`${name}-`) && !entry.endsWith('.lock') && !entry.endsWith('.tmp')) rmSync(path, { force: true });
  }
}

function tryLock(lock: string): number | undefined {
  try {
    return openSync(lock, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  try {
    if (Date.now() - statSync(lock).mtimeMs > 2 * 60_000) rmSync(lock, { force: true });
  } catch {
    // The holder released it between the two calls.
  }
  return undefined;
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

  const orm = await MikroORM.init({
    ...ormOptions(),
    dbName,
    host: server.hostname,
    password: decodeURIComponent(server.password),
    pool: { max: 8, min: 0 },
    port: Number(server.port || 5432),
    user: decodeURIComponent(server.username),
  });
  await orm.em.getConnection().execute('create extension if not exists pg_trgm');
  await createSchema(orm, options.schema ?? 'entities');
  const reset = await resetter(orm);

  return {
    async close() {
      await orm.close(true);
      await admin(`drop database if exists "${dbName}"`);
    },
    em: () => orm.em.fork(),
    orm,
    reset,
  };
}

/** Start a database for this test file, empty it before every test, and install it as `DI.em`. */
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
  beforeEach(async () => {
    await handle.reset();
    DI.em = handle.em();
    DI.orm = handle.orm;
  });
  afterAll(async () => {
    DI.orm = null;
    await handle.close();
  });

  return handle;
}
