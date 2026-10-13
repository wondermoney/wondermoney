import { Configuration } from '@mikro-orm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string> = {
  AWS_ACCESS_KEY_ID: 'aws',
  AWS_SECRET_ACCESS_KEY: 'aws',
  AZURE_AI_FOUNDRY_API_KEY: 'foundry',
  AZURE_AI_FOUNDRY_API_VERSION: '2024-05-01',
  AZURE_AI_FOUNDRY_ENDPOINT: 'https://example.test',
  AZURE_OPENAI_API_DEPLOYMENT_NAME: 'gpt',
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
});
