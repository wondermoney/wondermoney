import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lockClientConfig } from '../migrate';

// vitest.setup.ts mocks `dotenv`; the real module reads the fixture DOTENV_CONFIG_PATH names.
vi.unmock('dotenv');

const dotenvFixture = fileURLToPath(new URL('./fixtures/db-target.env', import.meta.url));
const DB_KEYS = ['DB_DATABASE', 'DB_HOST', 'DB_PASSWORD', 'DB_PORT', 'DB_USERNAME'] as const;

// The migration runner takes its advisory lock on its own `pg` client before the ORM starts.
// It must lock the database the migrations then run on; left without a target, `pg` would connect
// wherever the shell's `PG*` variables point.
describe('the migration lock client', () => {
  beforeEach(() => {
    for (const key of DB_KEYS) vi.stubEnv(key, undefined);
    vi.stubEnv('DOTENV_CONFIG_PATH', dotenvFixture);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('connects to the target .env names', () => {
    expect(lockClientConfig()).toEqual({
      database: 'wm_from_dotenv',
      host: 'from-dotenv.example.test',
      password: 'dotenv-password',
      port: 6001,
      user: 'dotenv_user',
    });
  });

  it('lets a DB_HOST exported in the shell win over .env', () => {
    vi.stubEnv('DB_HOST', 'exported.example.test');

    expect(lockClientConfig()).toMatchObject({ database: 'wm_from_dotenv', host: 'exported.example.test' });
  });

  it('connects to DATABASE_URL, TLS mode included, when the database is given that way', () => {
    vi.stubEnv('DOTENV_CONFIG_PATH', '/dev/null');
    vi.stubEnv('DATABASE_URL', 'postgres://wm:secret@db.example.test:6432/wondermoney?sslmode=verify-full');

    const client = new Client(lockClientConfig());

    expect(client).toMatchObject({ database: 'wondermoney', host: 'db.example.test', port: 6432, user: 'wm' });
    expect(client.ssl).toBeTruthy();
  });

  it('refuses DATABASE_URL beside DB_*, as the migrations themselves do', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://wm@db.example.test/wondermoney');

    expect(() => lockClientConfig()).toThrow(/DATABASE_URL and DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD are both set/);
  });

  it('refuses to start with no database instead of falling back to the shell PG* variables', () => {
    vi.stubEnv('DOTENV_CONFIG_PATH', '/dev/null');
    vi.stubEnv('PGHOST', 'from-pghost.example.test');

    expect(() => lockClientConfig()).toThrow(/DATABASE_URL or all of DB_HOST/);
  });
});
