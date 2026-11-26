import { fileURLToPath } from 'node:url';

import { Configuration } from '@mikro-orm/core';
import { PostgreSqlConnection } from '@mikro-orm/postgresql';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vitest.setup.ts mocks `dotenv` and points DOTENV_CONFIG_PATH at /dev/null. The real module is
// loaded here so the `.env` tests below read their fixture; the others still read /dev/null.
vi.unmock('dotenv');

const dotenvFixture = fileURLToPath(new URL('./fixtures/db-target.env', import.meta.url));
const DB_KEYS = ['DB_DATABASE', 'DB_HOST', 'DB_PASSWORD', 'DB_PORT', 'DB_USERNAME'] as const;

const env: Record<string, string> = {
  AWS_ACCESS_KEY_ID: 'aws',
  AWS_SECRET_ACCESS_KEY: 'aws',
  AZURE_AI_FOUNDRY_API_KEY: 'foundry',
  AZURE_AI_FOUNDRY_API_VERSION: '2024-05-01',
  AZURE_AI_FOUNDRY_ENDPOINT: 'https://example.test',
  AZURE_OPENAI_API_KEY: 'azure',
  AZURE_OPENAI_API_VERSION: '2024-05-01',
  AZURE_OPENAI_DEPLOYMENT: 'gpt',
  AZURE_OPENAI_ENDPOINT: 'https://example.test',
  AZURE_OPENAI_OCR_DEPLOYMENT: 'ocr',
  CREDENTIAL_ENCRYPTION_KEY_V1: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  DB_DATABASE: 'wm_staging',
  DB_HOST: 'db.internal',
  DB_PASSWORD: 'secret',
  DB_PORT: '5433',
  DB_USERNAME: 'wm',
  EMAIL_OPT_OUT_SIGNING_SECRET: 'opt-out',
  EODHD_API_KEY: 'eodhd',
  NODE_ENV: 'production',
  PGBOSS_MIGRATE: 'true',
  PGBOSS_PERSIST_WARNINGS: 'false',
  PGBOSS_SCHEDULE: 'true',
  PGBOSS_SCHEMA: 'pgboss',
  PGBOSS_SUPERVISE: 'false',
  RESEND_API_KEY: 'resend',
  RESEND_FROM_EMAIL: 'sender@example.test',
  RESEND_FROM_NAME: 'Sender',
};

describe('mikro-orm.config default export', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The migration entrypoint and DI bootstrap hand this object straight to MikroORM.init,
  // which merges options by enumerating keys. If it enumerates as empty, every deploy fails.
  it('gives MikroORM the configured connection target and compiled migrations path', async () => {
    const { default: options } = await import('../mikro-orm.config');

    const config = new Configuration(options, false);

    expect(config.get('host')).toBe('db.internal');
    expect(config.get('port')).toBe(5433);
    expect(config.get('dbName')).toBe('wm_staging');
    expect(config.get('user')).toBe('wm');
    expect(config.get('migrations').path).toBe('./dist/database/migrations');
  });

  describe('with the database settings only in .env', () => {
    beforeEach(() => {
      // Leave the target to the fixture; unstubAllEnvs then removes what it loaded.
      for (const key of DB_KEYS) vi.stubEnv(key, undefined);
      vi.stubEnv('DOTENV_CONFIG_PATH', dotenvFixture);
    });

    // The MikroORM CLI (`migrate:prd:pending`, `migrate:dev:check`, ...) runs nothing else that
    // would load `.env`, so without it the CLI saw no database at all.
    it('connects to the target .env names', async () => {
      const { default: options } = await import('../mikro-orm.config');

      const config = new Configuration(options, false);

      expect(config.get('host')).toBe('from-dotenv.example.test');
      expect(config.get('dbName')).toBe('wm_from_dotenv');
    });

    it('lets a DB_HOST exported in the shell win over .env', async () => {
      vi.stubEnv('DB_HOST', 'exported.example.test');
      const { default: options } = await import('../mikro-orm.config');

      const config = new Configuration(options, false);

      expect(config.get('host')).toBe('exported.example.test');
      expect(config.get('dbName')).toBe('wm_from_dotenv');
    });
  });

  // `migrate:prd:pending` is the MikroORM CLI with NODE_ENV=production and this config.
  it('resolves with only the database settings, no app secrets', async () => {
    for (const key of Object.keys(env)) {
      if (!key.startsWith('DB_') && key !== 'NODE_ENV') vi.stubEnv(key, undefined);
    }
    const { default: options } = await import('../mikro-orm.config');

    const config = new Configuration(options, false);

    expect(config.get('host')).toBe('db.internal');
    expect(config.get('dbName')).toBe('wm_staging');
  });

  describe('with the database given as DATABASE_URL', () => {
    beforeEach(() => {
      for (const key of DB_KEYS) vi.stubEnv(key, undefined);
      vi.stubEnv('DATABASE_URL', 'postgres://wm:secret@db.example.test:6432/wondermoney?sslmode=verify-full');
    });

    it('hands pg the whole URL, so it connects to that database over TLS', async () => {
      const { default: options } = await import('../mikro-orm.config');
      const config = new Configuration(options, false);

      // What MikroORM's own pool is built from.
      const client = new Client(new PostgreSqlConnection(config).mapOptions(config.get('driverOptions')));

      expect(config.get('dbName')).toBe('wondermoney');
      expect(client).toMatchObject({ database: 'wondermoney', host: 'db.example.test', port: 6432, user: 'wm' });
      expect(client.ssl).toBeTruthy();
    });

    it('refuses it beside DB_*, rather than choosing one', async () => {
      vi.stubEnv('DB_HOST', 'db.internal');
      const { default: options } = await import('../mikro-orm.config');

      expect(() => new Configuration(options, false)).toThrow(/DATABASE_URL and DB_HOST are both set/);
    });
  });
});
