/**
 * RAD-343 (D1) — better-auth identity/token helper for `e2e-household-flow.sh`.
 *
 * The household e2e proof used to provision users through the Supabase admin API and
 * exchange passwords for Supabase access tokens. Post better-auth there is no such
 * endpoint: identities are created in-process (`createBetterAuthUser`, wrapping
 * better-auth's `signUpEmail`) against the same `better_auth` schema the running API
 * uses, and tokens are minted by signing in over HTTP against that running API
 * (`POST /api/auth/sign-in/email`). The `bearer` plugin exposes the opaque session
 * token — the value `getAuthSession` accepts via `Authorization: Bearer` — as the
 * `set-auth-token` response header.
 *
 * Subcommands. stdout carries ONLY the machine-readable value; diagnostics go to stderr,
 * so the shell can capture ids/tokens without polluting them, and nothing is ever echoed.
 *
 *   create <email> <password>   -> prints the better-auth user id
 *   signin <email> <password>   -> prints a bearer session token
 *   delete <email>              -> removes the better-auth user (idempotent)
 *
 * Env:
 *   ENV_FILE  path to the API .env holding DB_* (loaded before the auth module imports,
 *             because better-auth builds its pg Pool from DB_* at module-evaluation time)
 *   API_URL   running API base URL (signin only); defaults to http://localhost:3001
 *
 * Usage:
 *   NODE_ENV=development NODE_OPTIONS='--import=tsx' \
 *     node src/database/scripts/e2e-household-flow.auth.ts create a@b.test secret
 */
import { existsSync } from 'node:fs';

function fail(message: string): never {
  console.error(`e2e auth helper: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, email, password] = process.argv.slice(2);
  if (!command || !email) return fail('usage: <create|signin|delete> <email> [password]');

  // Load the API .env before importing better-auth: the module builds its pg Pool from
  // DB_* at import time. dotenv never overrides a value already exported by the caller.
  const envFile = process.env['ENV_FILE'] ?? './.env';
  if (existsSync(envFile)) {
    const { config: loadEnvFile } = await import('dotenv');
    loadEnvFile({ path: envFile, quiet: true });
  }

  if (command === 'create') {
    if (!password) return fail('create requires a password');
    const { createBetterAuthUser } = await import('@service/auth/better-auth');
    const { id } = await createBetterAuthUser({ email, password });
    process.stdout.write(`${id}\n`);
    return;
  }

  if (command === 'signin') {
    if (!password) return fail('signin requires a password');
    const baseUrl = process.env['API_URL'] ?? 'http://localhost:3001';
    const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) return fail(`sign-in failed with HTTP ${response.status}`);
    // The bearer plugin mirrors the session token into `set-auth-token`; fall back to the
    // body's `token` (the same opaque session token) if a proxy strips the header.
    let token = response.headers.get('set-auth-token');
    if (!token) {
      const payload = (await response.json()) as { token?: string };
      token = payload.token ?? null;
    }
    if (!token) return fail('sign-in response did not expose a bearer token');
    process.stdout.write(`${token}\n`);
    return;
  }

  if (command === 'delete') {
    const { deleteBetterAuthUserByEmail } = await import('@service/auth/better-auth');
    await deleteBetterAuthUserByEmail(email);
    return;
  }

  return fail(`unknown command: ${command}`);
}

try {
  await main();
} catch (error) {
  console.error(`e2e auth helper: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
