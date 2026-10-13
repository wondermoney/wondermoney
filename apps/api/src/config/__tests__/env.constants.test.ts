import { afterEach, describe, expect, it, vi } from 'vitest';

const loadEnv = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  vi.unstubAllEnvs();

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      vi.stubEnv(key, value);
    }
  }

  return import('@config/env');
};

describe('app environment helper', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers APP_ENV over NODE_ENV', async () => {
    const { APP_ENV, IS_PROD, IS_STAGING } = await loadEnv({ APP_ENV: 'staging', NODE_ENV: 'production' });

    expect(APP_ENV).toBe('staging');
    expect(IS_STAGING).toBe(true);
    expect(IS_PROD).toBe(false);
  });

  it('falls back to NODE_ENV for tooling compatibility', async () => {
    const { APP_ENV } = await loadEnv({ NODE_ENV: 'production' });

    expect(APP_ENV).toBe('production');
  });

  it('defaults to development only when all envs are unset', async () => {
    const { APP_ENV } = await loadEnv({ APP_ENV: undefined, DEPLOY_ENV: undefined, NODE_ENV: undefined });

    expect(APP_ENV).toBe('test');
  });

  it('throws for invalid APP_ENV instead of silently falling back', async () => {
    await expect(loadEnv({ APP_ENV: 'banana' })).rejects.toThrow('Invalid app environment: banana');
  });

  it('throws for invalid DEPLOY_ENV instead of silently falling back', async () => {
    await expect(loadEnv({ DEPLOY_ENV: '' })).rejects.toThrow('Invalid app environment: ');
  });

  it('throws when a lower-priority env is invalid even if APP_ENV is valid', async () => {
    await expect(loadEnv({ APP_ENV: 'production', DEPLOY_ENV: 'banana' })).rejects.toThrow('Invalid app environment: banana');
  });

  it('treats staging as production-like for policies', async () => {
    const { IS_PRODUCTION_LIKE, SHOULD_DEBUG_SQL, SHOULD_ENABLE_SENTRY, SHOULD_INTERCEPT_EMAILS, SHOULD_PRETTY_LOGS } = await loadEnv({ APP_ENV: 'staging', SENTRY_DSN: 'dsn' });

    expect(IS_PRODUCTION_LIKE).toBe(true);
    expect(SHOULD_DEBUG_SQL).toBe(false);
    expect(SHOULD_PRETTY_LOGS).toBe(false);
    expect(SHOULD_ENABLE_SENTRY).toBe(true);
    expect(SHOULD_INTERCEPT_EMAILS).toBe(false);
  });
});
