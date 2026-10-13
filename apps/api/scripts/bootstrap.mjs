#!/usr/bin/env node
/**
 * One-command local bootstrap: `pnpm bootstrap`.
 *
 * Creates a local-by-construction `.env` (copied from `.env.sample`, whose DB_*
 * block already matches the compose Postgres), starts that Postgres, waits for it
 * to be healthy, then applies migrations and seeds.
 *
 * Never overwrites an existing `.env` — if you already have one, it is left alone
 * and the DB_* block is echoed back (host/port/database only, never credentials)
 * so you can confirm what you are about to migrate.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, '.env');
const samplePath = path.join(repoRoot, '.env.sample');

function run(command, args, { optional = false } = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    if (optional) {
      console.warn(`  (skipped: \`${command} ${args.join(' ')}\` exited ${String(result.status)})`);
      return false;
    }
    console.error(`\n✖ \`${command} ${args.join(' ')}\` failed.`);
    process.exit(result.status ?? 1);
  }
  return true;
}

/** Reads DB_HOST/DB_PORT/DB_DATABASE out of .env without printing any secret. */
function describeEnvTarget() {
  const contents = readFileSync(envPath, 'utf8');
  const read = (key) => {
    // last assignment wins, exactly like dotenv
    const matches = [...contents.matchAll(new RegExp(`^\\s*${key}\\s*=(.*)$`, 'gm'))];
    const last = matches.at(-1);
    return last ? last[1].trim() : '';
  };
  return { database: read('DB_DATABASE'), host: read('DB_HOST'), port: read('DB_PORT') };
}

console.log('WonderMoney API — local bootstrap');

// 1. .env
if (existsSync(envPath)) {
  console.log('\n• .env already exists — leaving it untouched.');
} else {
  copyFileSync(samplePath, envPath);
  console.log('\n• Created .env from .env.sample (local database pre-filled).');
  console.log('  Remaining blanks (third-party providers) are only needed for the');
  console.log('  features that use them. `pnpm devi` pulls the rest from Infisical.');
}

const target = describeEnvTarget();
console.log(`\n• Database target: DB_HOST=${target.host || '(unset)'} DB_PORT=${target.port || '(unset)'} DB_DATABASE=${target.database || '(unset)'}`);
if (!['127.0.0.1', '::1', 'localhost', 'postgres'].includes(target.host.toLowerCase())) {
  console.error('\n✖ .env does not point at a local database. Refusing to migrate/seed.');
  console.error('  Fix the DB_* block in .env (there must be exactly one) and re-run `pnpm bootstrap`.');
  process.exit(1);
}

// 2. Postgres
const composeUp =
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres'], { optional: true }) ||
  run('docker-compose', ['up', '-d', 'postgres'], { optional: true });

if (!composeUp) {
  console.warn('\n• Could not start Postgres via Docker Compose. If you run Postgres another way,');
  console.warn('  make sure it matches the DB_* block above, then run `pnpm migrate:dev && pnpm seed:dev`.');
  process.exit(1);
}

// 3. Schema + data
run('pnpm', ['migrate:dev']);
run('pnpm', ['seed:dev']);

console.log('\n✔ Done. Next: `pnpm dev` (or `pnpm devi` for Infisical-managed secrets).');
