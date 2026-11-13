#!/usr/bin/env node
// Scratch databases for this worktree on the shared test Postgres (TEST_POSTGRES_URL), named
// `<WM_TEST_DB_PREFIX>_<suffix>` (scripts/agent-env.mjs), so worktrees never share or drop each
// other's.
//
//   node scripts/scratch-db.mjs create <suffix>   # (re)create it empty; print the API's DB env for it
//   node scripts/scratch-db.mjs env <suffix>      # print that env only
//   node scripts/scratch-db.mjs drop <suffix>     # drop it
//   node scripts/scratch-db.mjs list              # this worktree's databases on the server
//   node scripts/scratch-db.mjs drop-all          # drop every one of them
//
// The printed env is one line of KEY=value pairs for `env`, with inert values for the secrets the
// API's scripts require:
//   env $(pnpm -s scratch-db create mig) pnpm --filter @wondermoney/api migrate:dev
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentEnv, repoRoot } from './agent-env.mjs';

const ROOT = repoRoot();
const { dbPrefix } = agentEnv(ROOT);

function serverUrl() {
  const url = process.env.TEST_POSTGRES_URL;
  if (!url) throw new Error('TEST_POSTGRES_URL is not set: point it at the shared test Postgres.');
  return url;
}

export function scratchName(suffix) {
  if (!/^[a-z0-9_]+$/.test(suffix ?? '')) throw new Error('The suffix must be lowercase letters, digits and underscores.');
  return `${dbPrefix}_${suffix}`;
}

async function admin(sql, params = []) {
  const pg = createRequire(join(ROOT, 'apps/api/package.json'))('pg');
  const client = new pg.Client({ connectionString: serverUrl() });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** The environment the API's migrate and seed scripts read, pointed at `database`. */
export function databaseEnv(database) {
  const server = new URL(serverUrl());
  return {
    CREDENTIAL_ENCRYPTION_KEY_V1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    DB_DATABASE: database,
    DB_HOST: server.hostname,
    DB_PASSWORD: decodeURIComponent(server.password),
    DB_PORT: server.port || '5432',
    DB_USERNAME: decodeURIComponent(server.username),
    EMAIL_OPT_OUT_SIGNING_SECRET: 'scratch-only',
  };
}

export async function dropDatabase(database) {
  await admin(`drop database if exists "${database}" with (force)`);
}

export async function createDatabase(database) {
  await dropDatabase(database);
  await admin(`create database "${database}" template template0`);
}

export async function listDatabases() {
  const rows = await admin('select datname from pg_database where starts_with(datname, $1) order by datname', [`${dbPrefix}_`]);
  return rows.map((row) => row.datname);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, suffix] = process.argv.slice(2);
  const line = (env) => Object.entries(env).map(([key, value]) => `${key}=${value}`).join(' ');
  try {
    if (command === 'create') {
      const database = scratchName(suffix);
      await createDatabase(database);
      console.log(line(databaseEnv(database)));
    } else if (command === 'env') {
      console.log(line(databaseEnv(scratchName(suffix))));
    } else if (command === 'drop') {
      await dropDatabase(scratchName(suffix));
    } else if (command === 'list') {
      for (const name of await listDatabases()) console.log(name);
    } else if (command === 'drop-all') {
      for (const name of await listDatabases()) {
        await dropDatabase(name);
        console.error(`dropped ${name}`);
      }
    } else {
      console.error('Usage: scratch-db create|env|drop <suffix> | list | drop-all');
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
