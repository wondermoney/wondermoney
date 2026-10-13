#!/usr/bin/env node
/**
 * Refuse to run a destructive database command against anything that is not a
 * local database.
 *
 * Why this exists: `src/mikro-orm.config.ts` connects to whatever `DB_HOST` /
 * `DB_PORT` / `DB_DATABASE` resolve to from the process env (loaded from `.env`),
 * with no regard for the `dev` or `prd` in the calling script's name. A `.env`
 * that has ever held a remote-database block — and this repo's has — means
 * `pnpm migrate:dev:fresh` is one line-reorder away from dropping staging or
 * production. Documentation is not a control; this is.
 *
 * Two tiers:
 *
 *   - **Destructive** (default, `*:fresh`) — deliberately un-overridable. There is no
 *     legitimate reason to drop a remote database from a `package.json` script.
 *   - **Writing** (`--opt-in`, `migrate:dev` / `seed:dev`) — these write to whatever `.env`
 *     resolves to, and CLAUDE.md explicitly recommends `migrate:dev` to move a real database
 *     forward, so a hard block would break a documented workflow. Instead the remote case
 *     must be *stated*: set `ALLOW_REMOTE_DB=1`. Accidents are blocked, intent is not.
 *
 * It resolves the host exactly the way the app does (existing process env wins
 * over `.env`, and within `.env` the last assignment wins) and never prints
 * credentials — only the host, port and database name.
 *
 * ## Known limitation — the locality test is host-only
 *
 * A remote database reached through an SSH or socat port-forward presents as
 * `localhost`, so it PASSES this check. This repo's `.env` currently reads
 * `DB_HOST=localhost DB_PORT=5433`, and per CLAUDE.md `:5433` is the staging forward —
 * so the guard cannot, as written, tell a local Postgres on 5433 apart from a forwarded
 * staging one.
 *
 * Closing it properly means asking the server what it is rather than trusting the address:
 * connect and compare `system_identifier` from `pg_control_system()`, or check for a marker
 * row that only local/CI databases have. That needs a connection and credentials, which is
 * why it is not done here — but the gap is real and this comment is not a substitute for
 * fixing it. Treat the guard as protection against the obvious mistake (a remote
 * block left in `.env`), not as proof the target is disposable.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, '.env');

// Same call the app makes. dotenv does NOT override variables already present in
// process.env, so an explicitly exported DB_HOST still wins — as it does at runtime.
if (existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const LOCAL_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'localhost',
  // docker-compose service names — inside the compose network these *are* the
  // local development database.
  'postgres',
  'db',
  'host.docker.internal',
]);

const host = (process.env['DB_HOST'] ?? '').trim();
const port = (process.env['DB_PORT'] ?? '').trim();
const database = (process.env['DB_DATABASE'] ?? '').trim();

const command = process.argv[2] ?? 'this destructive command';
/** `--opt-in`: a writing (not dropping) command — allow a remote target if explicitly stated. */
const optIn = process.argv.includes('--opt-in');
const remoteAllowed = process.env['ALLOW_REMOTE_DB'] === '1';

if (host === '') {
  console.error(
    `\n✖ Refusing to run ${command}: DB_HOST is not set, so the target database cannot be verified.\n` +
      `  Set a local DB_HOST in .env (see .env.sample) before running a destructive command.\n`,
  );
  process.exit(1);
}

if (!LOCAL_HOSTS.has(host.toLowerCase()) && optIn && remoteAllowed) {
  // Deliberate remote write. Say so loudly — the point is that it cannot happen silently.
  console.warn(
    `\n⚠ ${command} is targeting a REMOTE database, because ALLOW_REMOTE_DB=1 is set.\n\n` +
      `    DB_HOST     ${host}\n` +
      `    DB_PORT     ${port || '(unset)'}\n` +
      `    DB_DATABASE ${database || '(unset)'}\n`,
  );
  process.exit(0);
}

if (!LOCAL_HOSTS.has(host.toLowerCase()) && optIn) {
  console.error(
    `\n✖ Refusing to run ${command} against a non-local database.\n\n` +
      `    DB_HOST     ${host}\n` +
      `    DB_PORT     ${port || '(unset)'}\n` +
      `    DB_DATABASE ${database || '(unset)'}\n\n` +
      `  This command WRITES to the target database, and the \`dev\` in its name does not\n` +
      `  make the target local — it connects to whatever .env resolves to.\n\n` +
      `  If that is genuinely what you want, state it:  ALLOW_REMOTE_DB=1 pnpm ${command}\n`,
  );
  process.exit(1);
}

if (!LOCAL_HOSTS.has(host.toLowerCase())) {
  console.error(
    `\n✖ Refusing to run ${command} against a non-local database.\n\n` +
      `    DB_HOST     ${host}\n` +
      `    DB_PORT     ${port || '(unset)'}\n` +
      `    DB_DATABASE ${database || '(unset)'}\n\n` +
      `  This command DROPS the entire database. It is only ever allowed against a\n` +
      `  disposable local/CI database (${[...LOCAL_HOSTS].join(', ')}).\n\n` +
      `  If you meant to target a local database, fix the DB_* block in .env — and make\n` +
      `  sure there is only ONE of them, because dotenv keeps the last assignment.\n` +
      `  To move a real database forward, use the non-destructive \`pnpm migrate:dev\`.\n`,
  );
  process.exit(1);
}

console.log(`✔ ${command}: target is local (DB_HOST=${host}, DB_DATABASE=${database || '(unset)'}).`);
