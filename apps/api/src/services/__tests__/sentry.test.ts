import { beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();

vi.mock('@sentry/node', () => ({
  captureConsoleIntegration: vi.fn(),
  consoleLoggingIntegration: vi.fn(),
  expressIntegration: vi.fn(),
  init: initMock,
  pinoIntegration: vi.fn(),
  postgresIntegration: vi.fn(),
  rewriteFramesIntegration: vi.fn(),
}));

vi.mock('@utils/constants', () => ({
  GITHUB_SHA: 'test-sha',
}));

describe('sentry request sanitization', () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.resetModules();
  });

  it('sanitizes every request event', async () => {
    await import('@service/sentry');

    const config = initMock.mock.calls[0]?.[0];
    if (!config) throw new Error('sentry config was not captured');
    const event = config.beforeSend({
      request: {
        data: { email: 'user@example.com', params: { accountId: '123' } },
        headers: { authorization: 'Bearer x', cookie: 'a=b', 'x-request-id': 'req-1' },
        query_string: 'email=user%40example.com&accountId=123',
        url: '/v1/accounts/123?email=user%40example.com',
      },
    });

    expect(event.request).toEqual({
      cookies: undefined,
      data: { redacted: true, type: 'object' },
      headers: { authorization: '[REDACTED]', cookie: '[REDACTED]', 'x-request-id': 'req-1' },
      query_string: '[REDACTED]',
      url: '/v1/accounts/123',
    });
  });

  it('drops scanner NotFoundError noise', async () => {
    await import('@service/sentry');

    const config = initMock.mock.calls[0]?.[0];
    if (!config) throw new Error('sentry config was not captured');

    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/.env' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: 'https://api.wonder.money/.env' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/wp-content/uploads/file.txt' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/robots.txt' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/src/.env.local' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/web/.env.production' } })).toBeNull();
    // Root-level archive/backup/dump probes.
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/htdocs.tar.gz' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: 'https://api.wonder.money/backup.zip' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/db.sql' } })).toBeNull();
    // A real not-found on an API path is still reported.
    expect(config.beforeSend({ exception: { values: [{ type: 'NotFoundError' }] }, request: { url: '/v1/account/999' } })).not.toBeNull();
  });

  it('drops /docs scanner probes and rate-limiter invalid-IP noise', async () => {
    await import('@service/sentry');

    const config = initMock.mock.calls[0]?.[0];
    if (!config) throw new Error('sentry config was not captured');

    // Scanners hitting the API-key-protected Swagger docs.
    expect(config.beforeSend({ exception: { values: [{ type: 'UnauthorizedError' }] }, request: { url: '/docs' } })).toBeNull();
    expect(config.beforeSend({ exception: { values: [{ type: 'ValidationError', value: 'invalid IP address' }] }, request: { url: '/docs' } })).toBeNull();
    // Rate-limiter invalid-IP is noise on any path, not just admin.
    expect(
      config.beforeSend({
        exception: { values: [{ mechanism: { type: 'express-rate-limit' }, type: 'ValidationError', value: 'ValidationError: invalid IP address' }] },
        request: { url: '/v1/banking/bank' },
      }),
    ).toBeNull();
    // A genuine 401 on a real API path is still reported.
    expect(config.beforeSend({ exception: { values: [{ type: 'UnauthorizedError' }] }, request: { url: '/v1/account' } })).not.toBeNull();
  });

  it('does not capture console.log as issues', async () => {
    const Sentry = await import('@sentry/node');
    await import('@service/sentry');

    const captureConsoleCall = (Sentry.captureConsoleIntegration as unknown as { mock: { calls: [{ levels: string[] }][] } }).mock.calls[0]?.[0];
    expect(captureConsoleCall?.levels).toBeDefined();
    expect(captureConsoleCall?.levels).not.toContain('log');
    expect(captureConsoleCall?.levels).toContain('error');
  });

  it('drops admin auth and rate-limit noise only on admin paths', async () => {
    await import('@service/sentry');

    const config = initMock.mock.calls[0]?.[0];
    if (!config) throw new Error('sentry config was not captured');

    expect(config.beforeSend({ exception: { values: [{ type: 'UnauthorizedError' }] }, request: { url: '/v1/admin/users' } })).toBeNull();
    expect(
      config.beforeSend({
        exception: { values: [{ mechanism: { type: 'express-rate-limit' }, type: 'ValidationError', value: 'ValidationError: invalid IP address' }] },
        request: { url: '/v1/admin/users' },
      }),
    ).toBeNull();

    expect(
      config.beforeSend({
        exception: { values: [{ type: 'ValidationError', value: 'ValidationError: missing required field' }] },
        request: { url: '/v1/admin/users' },
      }),
    ).not.toBeNull();

    expect(
      config.beforeSend({
        exception: { values: [{ type: 'UnauthorizedError' }] },
        request: { url: '/v1/accounts/1' },
      }),
    ).not.toBeNull();
  });
});
