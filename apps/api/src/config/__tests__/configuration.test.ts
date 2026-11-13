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

  it('reports an unsafe TRUST_PROXY at startup, by name', () => {
    expect(() => loadConfiguration('api', { ...validApi, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfiguration('api', { ...validApi, TRUST_PROXY: '1' })).not.toThrow();
  });

  it('takes a merchant logo template only as an https URL with {domain} after the host', () => {
    expect(() => loadConfiguration('api', { ...validApi, MERCHANT_LOGO_URL_TEMPLATE: 'https://logos.example.com/{domain}.png' })).not.toThrow();
    expect(() => loadConfiguration('api', { ...validApi, MERCHANT_LOGO_URL_TEMPLATE: 'https://logos.example.com/img?domain={domain}' })).not.toThrow();
    expect(() => loadConfiguration('api', { ...validApi, MERCHANT_LOGO_URL_TEMPLATE: 'http://logos.example.com/{domain}.png' })).toThrow(/MERCHANT_LOGO_URL_TEMPLATE/);
    expect(() => loadConfiguration('api', { ...validApi, MERCHANT_LOGO_URL_TEMPLATE: 'https://logos.example.com/logo.png' })).toThrow(/MERCHANT_LOGO_URL_TEMPLATE/);
    // The domain may not choose the host the server fetches from.
    expect(() => loadConfiguration('api', { ...validApi, MERCHANT_LOGO_URL_TEMPLATE: 'https://{domain}/favicon.ico' })).toThrow(/MERCHANT_LOGO_URL_TEMPLATE/);
  });

  it('takes the crypto explorer URLs only as https URLs, on the API and the worker', () => {
    // Empty, as the env samples ship them: off.
    expect(() => loadConfiguration('api', { ...validApi, CRYPTO_BTC_EXPLORER_URL: '', CRYPTO_ETH_EXPLORER_URL: '' })).not.toThrow();
    expect(() => loadConfiguration('api', { ...validApi, CRYPTO_BTC_EXPLORER_URL: 'https://mempool.example.org/api', CRYPTO_ETH_EXPLORER_URL: 'https://blockscout.example.org/' })).not.toThrow();
    expect(() => loadConfiguration('worker', { ...validShared, CRYPTO_BTC_EXPLORER_URL: 'https://mempool.example.org/api' })).not.toThrow();
    expect(() => loadConfiguration('api', { ...validApi, CRYPTO_BTC_EXPLORER_URL: 'http://mempool.example.org/api' })).toThrow(/CRYPTO_BTC_EXPLORER_URL/);
    expect(() => loadConfiguration('worker', { ...validShared, CRYPTO_ETH_EXPLORER_URL: 'blockscout.example.org' })).toThrow(/CRYPTO_ETH_EXPLORER_URL/);
    expect(() => loadConfiguration('api', { ...validApi, CRYPTO_ETH_EXPLORER_URL: 'https://user:pass@blockscout.example.org' })).toThrow(/CRYPTO_ETH_EXPLORER_URL/);
    expect(() => loadConfiguration('api', { ...validApi, CRYPTO_BTC_EXPLORER_URL: 'https://mempool.example.org/api?key=1' })).toThrow(/CRYPTO_BTC_EXPLORER_URL/);
  });

  it('takes MARKET_DATA_PROVIDERS as an ordered list of known providers and refuses anything else', () => {
    expect(loadConfiguration('api', validApi).integrations.marketDataProviders).toEqual(['eodhd']);
    expect(loadConfiguration('api', { ...validApi, MARKET_DATA_PROVIDERS: '' }).integrations.marketDataProviders).toEqual(['eodhd']);
    expect(loadConfiguration('worker', { ...validShared, MARKET_DATA_PROVIDERS: ' Stooq , eodhd,coingecko ' }).integrations.marketDataProviders)
      .toEqual(['stooq', 'eodhd', 'coingecko']);

    expect(() => loadConfiguration('api', { ...validApi, MARKET_DATA_PROVIDERS: 'eodhd,yahoo' })).toThrow(/MARKET_DATA_PROVIDERS.*yahoo/);
    expect(() => loadConfiguration('worker', { ...validShared, MARKET_DATA_PROVIDERS: 'stooq,stooq' })).toThrow(/MARKET_DATA_PROVIDERS.*more than once/);
  });

  it('takes the cross-currency transfer tolerance as a fraction and refuses a percentage', () => {
    expect(() => loadConfiguration('worker', { ...validShared, TRANSFER_MATCH_FX_TOLERANCE: '0.02' })).not.toThrow();
    expect(() => loadConfiguration('api', { ...validApi, TRANSFER_MATCH_FX_TOLERANCE: '0' })).not.toThrow();
    // "2" meant as 2 percent would accept any amount within 200 percent: refused at boot.
    expect(() => loadConfiguration('worker', { ...validShared, TRANSFER_MATCH_FX_TOLERANCE: '2' })).toThrow(/TRANSFER_MATCH_FX_TOLERANCE/);
    expect(() => loadConfiguration('api', { ...validApi, TRANSFER_MATCH_FX_TOLERANCE: '2%' })).toThrow(/TRANSFER_MATCH_FX_TOLERANCE/);
    expect(() => loadConfiguration('api', { ...validApi, TRANSFER_MATCH_FX_TOLERANCE: '-0.01' })).toThrow(/TRANSFER_MATCH_FX_TOLERANCE/);
  });

  it('takes the PDF statement limits as positive whole numbers, on the API and the worker', () => {
    expect(() => loadConfiguration('api', { ...validApi, STATEMENT_IMPORT_MAX_BYTES: '5242880', STATEMENT_IMPORT_MAX_PAGES: '5' })).not.toThrow();
    expect(() => loadConfiguration('worker', { ...validShared, STATEMENT_IMPORT_MAX_PAGES: '40' })).not.toThrow();
    for (const value of ['0', '-1', '10MB', '2.5', 'many']) {
      expect(() => loadConfiguration('api', { ...validApi, STATEMENT_IMPORT_MAX_BYTES: value })).toThrow(/STATEMENT_IMPORT_MAX_BYTES/);
      expect(() => loadConfiguration('worker', { ...validShared, STATEMENT_IMPORT_MAX_PAGES: value })).toThrow(/STATEMENT_IMPORT_MAX_PAGES/);
    }
    expect(() => loadConfiguration('api', { ...validApi, AI_DAILY_LIMIT_STATEMENT_IMPORT: 'lots' })).toThrow(/AI_DAILY_LIMIT_STATEMENT_IMPORT/);
  });

  it('takes the minimum unattended sync interval in hours and refuses anything that is not a positive number', () => {
    expect(() => loadConfiguration('worker', { ...validShared, BANK_SYNC_MIN_INTERVAL_HOURS: '6' })).not.toThrow();
    expect(() => loadConfiguration('worker', { ...validShared, BANK_SYNC_MIN_INTERVAL_HOURS: '0.5' })).not.toThrow();
    for (const value of ['0', '-6', '6h', 'six', 'Infinity', 'NaN']) {
      expect(() => loadConfiguration('worker', { ...validShared, BANK_SYNC_MIN_INTERVAL_HOURS: value })).toThrow(/BANK_SYNC_MIN_INTERVAL_HOURS/);
    }
  });

  it('takes the local Bayes thresholds as fractions and refuses anything outside 0 to 1', () => {
    expect(() => loadConfiguration('api', { ...validApi, TRANSACTION_BAYES_CATEGORIZATION_ENABLED: 'false', TRANSACTION_BAYES_MIN_MARGIN: '0.2', TRANSACTION_BAYES_MIN_POSTERIOR: '0.8' })).not.toThrow();
    expect(() => loadConfiguration('worker', { ...validShared, TRANSACTION_BAYES_CATEGORIZATION_ENABLED: 'maybe' })).toThrow(/TRANSACTION_BAYES_CATEGORIZATION_ENABLED/);
    for (const value of ['2', '-0.1', '80%']) {
      expect(() => loadConfiguration('api', { ...validApi, TRANSACTION_BAYES_MIN_POSTERIOR: value })).toThrow(/TRANSACTION_BAYES_MIN_POSTERIOR/);
      expect(() => loadConfiguration('api', { ...validApi, TRANSACTION_BAYES_MIN_MARGIN: value })).toThrow(/TRANSACTION_BAYES_MIN_MARGIN/);
    }
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

  it('classifies an absent required key as missing and a malformed one as invalid', () => {
    const { ADMIN_API_KEY: _admin, ...withoutAdmin } = validApi;
    const error = (() => {
      try {
        loadConfiguration('api', { ...withoutAdmin, CREDENTIAL_ENCRYPTION_KEY_V1: 'not-a-key' });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing', path: 'ADMIN_API_KEY' }),
      expect.objectContaining({ code: 'invalid-value', path: 'CREDENTIAL_ENCRYPTION_KEY_V1' }),
    ]));
  });
});
