import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { assertEnv, EnvValidationError, loadEnv } from '@app/config/env';

/** A minimally-valid environment for whichever role is under test. */
function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ACCOUNT_AUTO_SYNC_MAX_ENQUEUED: '50',
    ADMIN_API_KEY: 'admin-key',
    AWS_ACCESS_KEY_ID: 'aws-id',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    AZURE_AI_FOUNDRY_API_KEY: 'foundry-key',
    AZURE_AI_FOUNDRY_API_VERSION: '2026-01-01',
    AZURE_AI_FOUNDRY_ENDPOINT: 'https://example.services.ai.azure.com',
    AZURE_OPENAI_API_DEPLOYMENT_NAME: 'gpt-deployment',
    AZURE_OPENAI_API_KEY: 'azure-key',
    AZURE_OPENAI_API_VERSION: '2026-01-01',
    AZURE_OPENAI_DEPLOYMENT: 'gpt-deployment',
    AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
    AZURE_OPENAI_OCR_DEPLOYMENT: 'gpt-ocr',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    // Must be real base64 decoding to 32 bytes — the schema checks the shape, not just
    // presence, after production shipped a 34-byte key that passed a non-empty check.
    CREDENTIAL_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    // The DB_* trio as well: a connection target may be given either way, and including
    // both means removing one does not masquerade as "required".
    DB_DATABASE: 'wmdb',
    DB_HOST: 'localhost',
    DB_PASSWORD: 'pw',
    DB_PORT: '5432',
    DB_USERNAME: 'wm',
    EMAIL_OPT_OUT_SIGNING_SECRET: 'opt-out-secret',
    ENABLE_PGBOSS_DEMO_DATA_REFRESH: 'false',
    EODHD_API_KEY: 'eodhd-key',
    INTERNAL_SERVICE_API_KEY: 'internal-key',
    NODE_ENV: 'production',
    PGBOSS_MIGRATE: 'true',
    PGBOSS_PERSIST_WARNINGS: 'false',
    PGBOSS_SCHEDULE: 'true',
    PGBOSS_SCHEMA: 'pgboss',
    PGBOSS_SUPERVISE: 'true',
    POSTHOG_API_KEY: 'posthog-key',
    RECAPTCHA_SECRET_KEY: 'recaptcha-secret',
    RESEND_API_KEY: 'resend-key',
    RESEND_FROM_EMAIL: 'hello@example.com',
    RESEND_FROM_NAME: 'WonderMoney',
    TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION: 'DeepSeek-V4-Flash',
    ...overrides,
  };
}

describe('environment validation', () => {
  it('accepts a complete environment for either role', () => {
    expect(() => loadEnv({ role: 'api', source: validEnv() })).not.toThrow();
    expect(() => loadEnv({ role: 'worker', source: validEnv() })).not.toThrow();
  });

  it('is pure — it reads the passed source, never process.env', () => {
    const parsed = loadEnv({ role: 'api', source: validEnv({ RESEND_API_KEY: 'from-argument' }) });
    expect(parsed['RESEND_API_KEY']).toBe('from-argument');
  });

  it('boots on a database and its own secrets alone, with every third-party integration unset', () => {
    // Self-hosting: AI, market data, S3, Resend, PostHog and reCAPTCHA are each optional, and
    // the features that need them report themselves disabled instead of blocking boot.
    const minimal = {
      ADMIN_API_KEY: 'admin-key',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
      CREDENTIAL_ENCRYPTION_KEY_V1: Buffer.alloc(32, 1).toString('base64'),
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      EMAIL_OPT_OUT_SIGNING_SECRET: 'opt-out-secret',
      INTERNAL_SERVICE_API_KEY: 'internal-key',
      NODE_ENV: 'production',
    };
    expect(() => loadEnv({ role: 'api', source: minimal })).not.toThrow();
    expect(() => loadEnv({ role: 'worker', source: minimal })).not.toThrow();
  });

  it('does not demand API-only secrets from the worker', () => {
    // The worker receives no webhooks and serves no HTTP, so forcing operators to set these
    // on the worker scopes is how divergence starts.
    const source = validEnv({
      ADMIN_API_KEY: undefined,
      RECAPTCHA_SECRET_KEY: undefined,
    });
    expect(() => loadEnv({ role: 'worker', source })).not.toThrow();
    expect(() => loadEnv({ role: 'api', source })).toThrow();
  });

  it('reports every problem at once, not one redeploy at a time', () => {
    // Optional integrations are still validated when present: a malformed value is a typo.
    const source = validEnv({ ADMIN_API_KEY: undefined, AI_BASE_URL: 'not a url', RESEND_FROM_EMAIL: 'not-an-email' });
    const error = (() => {
      try {
        loadEnv({ role: 'api', source });
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(EnvValidationError);
    const problems = (error as EnvValidationError).problems.join('\n');
    const keys = new Set((error as EnvValidationError).problems.map((problem) => problem.split(':')[0]));
    expect(keys).toEqual(new Set(['ADMIN_API_KEY', 'AI_BASE_URL', 'RESEND_FROM_EMAIL']));
    expect(problems).toMatch(/AI_BASE_URL/);
    expect(problems).toMatch(/ADMIN_API_KEY/);
    expect(problems).toMatch(/RESEND_FROM_EMAIL/);
  });

  it('treats an empty variable as unset, which is how docker compose passes `KEY=` from .env', () => {
    expect(() => loadEnv({ role: 'api', source: validEnv({ AI_BASE_URL: '', EMAIL_FROM: '', S3_ENDPOINT: '', SUPPORT_EMAIL: '' }) })).not.toThrow();
  });

  it('rejects a whitespace-only secret, which is what a mis-pasted dashboard field looks like', () => {
    expect(() => loadEnv({ role: 'api', source: validEnv({ ADMIN_API_KEY: '   ' }) })).toThrow(/ADMIN_API_KEY/);
  });

  it('accepts either DATABASE_URL or the discrete DB_* set, but not neither', () => {
    const discrete = validEnv({
      DATABASE_URL: undefined,
      DB_DATABASE: 'wondermoney',
      DB_HOST: 'localhost',
      DB_USERNAME: 'postgres',
    });
    expect(() => loadEnv({ role: 'api', source: discrete })).not.toThrow();

    // "Neither" means clearing both forms — the fixture supplies both, so dropping only
    // DATABASE_URL leaves a perfectly valid discrete configuration behind.
    const neither = validEnv({
      DATABASE_URL: undefined, DB_DATABASE: undefined, DB_HOST: undefined, DB_USERNAME: undefined,
    });
    expect(() => loadEnv({ role: 'api', source: neither })).toThrow(/DATABASE_URL/);
  });

  it('skips validation under test so unit tests need no real credentials', () => {
    expect(() => { assertEnv('api', { NODE_ENV: 'test' }); }).not.toThrow();
    expect(() => { assertEnv('api', { VITEST: 'true' }); }).not.toThrow();
  });

  it('throws on incomplete config, so the container refuses to start', () => {
    // No flag guards this. A lazily-constructed client (EODHD is the example) turns a
    // missing secret into a runtime failure weeks later on a low-traffic path; failing at
    // boot is the entire point of the check.
    expect(() => { assertEnv('api', { NODE_ENV: 'production' }); }).toThrow();
  });

  it('logs every problem at once as well as throwing', () => {
    // The throw gives a stack trace; the log gives the operator the full list, so fixing
    // the scope takes one pass instead of one redeploy per missing variable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => { assertEnv('api', { NODE_ENV: 'production' }); }).toThrow();
    expect(consoleError).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as { problems: string[] };
    expect(logged.problems.length).toBeGreaterThan(0);

    consoleError.mockRestore();
  });

  it('stays inert under test so unit tests need no real credentials', () => {
    expect(() => { assertEnv('api', { NODE_ENV: 'test' }); }).not.toThrow();
    expect(() => { assertEnv('api', { VITEST: 'true' }); }).not.toThrow();
  });
});

describe('CREDENTIAL_ENCRYPTION_KEY_V1 format', () => {
  const withKey = (key: string) => validEnv({ CREDENTIAL_ENCRYPTION_KEY_V1: key });

  it('accepts a real 32-byte base64 key', () => {
    expect(() => loadEnv({ role: 'worker', source: withKey(Buffer.alloc(32, 7).toString('base64')) })).not.toThrow();
  });

  it('rejects a 34-byte key — non-empty, valid base64, wrong length', () => {
    // The shape `nonEmpty` waves through. `resolveMasterKey` would reject it, but only on
    // the first credential someone tries to encrypt, which is a lazy path.
    const wrongLength = Buffer.alloc(34, 3).toString('base64');
    expect(() => loadEnv({ role: 'worker', source: withKey(wrongLength) })).toThrow();
  });

  it('rejects a key of the right length that is not valid base64', () => {
    // Buffer's decoder skips invalid characters, so junk can still yield 32 bytes.
    // Strict charset matching is what stops that.
    expect(() => loadEnv({ role: 'worker', source: withKey('!'.repeat(44)) })).toThrow();
  });

  it('rejects a 16-byte key — right encoding, wrong strength', () => {
    expect(() => loadEnv({ role: 'worker', source: withKey(Buffer.alloc(16).toString('base64')) })).toThrow();
  });
});

describe('.env.sample documents the contract', () => {
  // Not a source-text assertion for its own sake: a required variable missing from the
  // sample means a new developer copies it, boots, and the container refuses to start —
  // which is a new failure mode now that validation is unconditional. Four were already
  // missing when this was written.
  it('lists every required variable', () => {
    const sample = readFileSync(join(process.cwd(), '.env.sample'), 'utf8');
    const documented = new Set(
      sample.split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
        .map((line) => line.slice(0, line.indexOf('='))),
    );

    // A key is required for a role if clearing it makes that role fail to load.
    const required = Object.keys(validEnv()).filter((key) => {
      const cleared = validEnv({ [key]: undefined });
      return (['api', 'worker'] as const).some((role) => {
        try { loadEnv({ role, source: cleared }); return false; } catch { return true; }
      });
    });

    expect(required.filter((key) => !documented.has(key)).sort()).toEqual([]);
  });
});
