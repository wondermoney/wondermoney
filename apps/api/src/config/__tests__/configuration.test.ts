import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  type ConfigurationSource,
  loadConfiguration,
} from '../configuration';

const validShared: ConfigurationSource = Object.freeze({
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
  DB_DATABASE: 'app',
  DB_HOST: 'localhost',
  DB_PASSWORD: 'secret',
  DB_PORT: '5432',
  DB_USERNAME: 'app',
  EMAIL_OPT_OUT_SIGNING_SECRET: 'opt-out',
  EODHD_API_KEY: 'eodhd',
  NODE_ENV: 'test',
  PGBOSS_MIGRATE: 'true',
  PGBOSS_PERSIST_WARNINGS: 'false',
  PGBOSS_SCHEDULE: 'true',
  PGBOSS_SCHEMA: 'pgboss',
  PGBOSS_SUPERVISE: 'false',
  RESEND_API_KEY: 'resend',
  RESEND_FROM_EMAIL: 'sender@example.test',
  RESEND_FROM_NAME: 'Sender',
});

const apiOnly: ConfigurationSource = Object.freeze({
  ADMIN_API_KEY: 'admin',
  CORS_ALLOWED_ORIGINS: 'https://example.test',
  INTERNAL_SERVICE_API_KEY: 'internal',
  RECAPTCHA_SECRET_KEY: 'recaptcha',
});

const validApi: ConfigurationSource = Object.freeze({ ...validShared, ...apiOnly });

describe('loadConfiguration', () => {
  it('builds an immutable api configuration with parsed values', () => {
    const api = loadConfiguration('api', validApi);

    expect(api.role).toBe('api');
    expect(api.runtime.isTest).toBe(true);
    expect(api.database.host).toBe('localhost');
    expect(api.database.port).toBe(5432);
    expect(api.pgBoss.schema).toBe('pgboss');
    expect(api.integrations.eodhdApiKey).toBe('eodhd');
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.runtime)).toBe(true);
    expect(Object.isFrozen(api.integrations)).toBe(true);
  });

  it('aggregates multiple problems into one error', () => {
    expect(() => loadConfiguration('api', { ...validApi, ADMIN_API_KEY: '', RESEND_API_KEY: '' }))
      .toThrow(ConfigurationError);
  });

  it('requires either DATABASE_URL or discrete db values', () => {
    const { DB_DATABASE: _d, DB_HOST: _h, DB_PASSWORD: _w, DB_PORT: _p, DB_USERNAME: _u, ...rest } = validApi;
    expect(() => loadConfiguration('api', rest)).toThrow(ConfigurationError);
  });

  it('parses worker roles with worker-only fields', () => {
    const worker = loadConfiguration('worker', {
      ...validShared,
      ENABLE_PGBOSS_DEMO_DATA_REFRESH: 'true',
      PGBOSS_SCHEDULER_MODE: 'live',
      POSTHOG_API_KEY: 'posthog',
      TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION: 'v1',
    });
    expect(worker.role).toBe('worker');
    expect(worker.jobs.analytics.posthogApiKey).toBe('posthog');
    expect(worker.jobs.enrichment.schedulerMode).toBe('live');
  });

  it('rejects unknown worker rollout values', () => {
    expect(() => loadConfiguration('worker', { ...validShared, PGBOSS_SCHEDULER_MODE: 'liv', POSTHOG_API_KEY: 'posthog', TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION: 'v1' })).toThrow(ConfigurationError);
  });
});
