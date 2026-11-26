#!/usr/bin/env node
/**
 * Refuse to run a destructive database command against anything that is not a
 * local database.
 *
 * Why this exists: `src/mikro-orm.config.ts` connects to whatever `DATABASE_URL`, or
 * else `DB_HOST` / `DB_PORT` / `DB_DATABASE`, resolve to from the process env (loaded
 * from `.env`), with no regard for the `dev` or `prd` in the calling script's name. A `.env`
 * that has ever held a remote-database block — and this repo's has — means
 * `pnpm migrate:dev:fresh` is one line-reorder away from dropping staging or
 * production. Documentation is not a control; this is.
 *
 * Two tiers:
 *
 *   - **Destructive** (default, `*:fresh`) — deliberately un-overridable. There is no
 *     legitimate reason to drop a remote database from a `package.json` script.
 *   - **Writing** (`--opt-in`: `migrate:dev`, `migrate:manual`, `seed:dev`, `demo:*:dev`) —
 *     these write to whatever `.env` resolves to, and CLAUDE.md explicitly recommends `migrate:dev` to move a real database
 *     forward, so a hard block would break a documented workflow. Instead the remote case
 *     must be *stated*: set `ALLOW_REMOTE_DB=1`. Accidents are blocked, intent is not.
 *
 * It resolves the host exactly the way the app does (existing process env wins
 * over `.env`, and within `.env` the last assignment wins) and never prints
 * credentials — only the host, port and database name. It also refuses a
 * `MIKRO_ORM_CLIENT_URL` / `MIKRO_ORM_HOST` naming a non-local host and any
 * `MIKRO_ORM_DB_NAME`, which MikroORM would merge over the `DB_*` target. The rules
 * are in `src/config/local-db-guard.ts`, with their tests.
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
import process from 'node:process';

// Node strips the types of these plain TypeScript modules. The guard loads `.env` with the same
// helper as the app and the MikroORM CLI: an exported DB_HOST wins over `.env`, and within
// `.env` the last assignment wins.
import { checkLocalDbTarget } from '../src/config/local-db-guard.ts';
import { loadDotenv } from '../src/config/load-dotenv.ts';

loadDotenv();

const result = checkLocalDbTarget({
  command: process.argv[2] ?? 'this destructive command',
  env: process.env,
  optIn: process.argv.includes('--opt-in'),
});

if (result.level === 'ok') console.log(result.message);
else if (result.level === 'warn') console.warn(result.message);
else console.error(result.message);

process.exit(result.allowed ? 0 : 1);
