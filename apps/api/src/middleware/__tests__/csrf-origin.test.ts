import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { csrfOriginProtection, getCsrfAllowedOrigins, isCsrfOriginAllowed } from '@middleware/csrf-origin';

interface TestRequestOverrides {
  cookies?: Record<string, string>;
  get?: Request['get'];
  method?: string;
  path?: string;
}

function createHeaderGetter(handler: (header: string) => string | undefined): Request['get'] {
  return vi.fn(handler) as unknown as Request['get'];
}

function createNext() {
  return vi.fn<(error?: unknown) => void>();
}

function createReq(overrides: TestRequestOverrides = {}): Request {
  return {
    cookies: { 'better-auth.session_token': 'present' },
    get: createHeaderGetter((header: string) => {
      if (header === 'Origin') return 'https://app.wonder.money';
      return undefined;
    }),
    method: 'POST',
    path: '/v1/account',
    ...overrides,
  } as unknown as Request;
}

function createResponse(): Response {
  return {} as Response;
}

function runCsrfOriginProtection(req: Request, next: ReturnType<typeof createNext>) {
  csrfOriginProtection(req, createResponse(), next);
}

describe('csrfOriginProtection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('rejects cookie-authenticated writes from disallowed origins', () => {
    const req = createReq({ get: createHeaderGetter((header: string) => (header === 'Origin' ? 'https://evil.example' : undefined)) });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ message: 'Invalid request origin' });
  });

  it('allows cookie-authenticated writes from allowed origins', () => {
    const req = createReq({
      get: createHeaderGetter((header: string) => {
        if (header === 'Origin') return undefined;
        if (header === 'Referer') return 'http://localhost:3000/settings';
        return undefined;
      }),
    });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('allows bearer-authenticated writes without checking origin', () => {
    const req = createReq({
      cookies: {},
      get: createHeaderGetter((header: string) => {
        if (header === 'Origin') return 'https://evil.example';
        if (header === 'Authorization') return 'Bearer token-123';
        return undefined;
      }),
    });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('allows requests without cookie auth', () => {
    const req = createReq({ cookies: {}, get: createHeaderGetter(() => undefined) });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it.each([
    ['__Secure- prefixed https cookie', '__Secure-better-auth.session_token'],
    ['chunked session cookie', 'better-auth.session_token.0'],
  ])('checks origin for %s', (_label, cookieName) => {
    const req = createReq({
      cookies: { [cookieName]: 'present' },
      get: createHeaderGetter((header: string) => (header === 'Origin' ? 'https://evil.example' : undefined)),
    });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ message: 'Invalid request origin' });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows safe %s requests', (method) => {
    const req = createReq({ method });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('rejects missing origin and referer on cookie-authenticated writes', () => {
    const req = createReq({
      get: createHeaderGetter(() => undefined),
    });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ message: 'Invalid request origin' });
  });

  it.each(['/v1/admin/users', '/v1/internal/jobs'])('exempts %s', (path) => {
    const req = createReq({ get: createHeaderGetter(() => undefined), path });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('rejects cookie-authenticated writes with a bearer-looking header from disallowed origins', () => {
    const req = createReq({
      get: createHeaderGetter((header: string) => {
        if (header === 'Origin') return 'https://evil.example';
        if (header === 'Authorization') return 'Bearer token-123';
        return undefined;
      }),
    });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ message: 'Invalid request origin' });
  });

  it('does not exempt lookalike admin paths', () => {
    const req = createReq({ get: createHeaderGetter(() => undefined), path: '/v1/admin-anything' });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ message: 'Invalid request origin' });
  });

  it('derives CSRF origins from explicit env vars', () => {
    vi.stubEnv('CSRF_ALLOWED_ORIGINS', 'https://one.example, https://two.example ');

    expect(getCsrfAllowedOrigins({ CSRF_ALLOWED_ORIGINS: process.env['CSRF_ALLOWED_ORIGINS'] })).toEqual([
      'https://one.example',
      'https://two.example',
    ]);
  });

  it('normalizes configured CSRF origins', () => {
    expect(getCsrfAllowedOrigins({ CSRF_ALLOWED_ORIGINS: 'https://app.wonder.money/' })).toEqual([
      'https://app.wonder.money',
    ]);
  });

  it('fails closed to production origins for unknown environments', () => {
    expect(getCsrfAllowedOrigins({ APP_ENV: 'prod', APP_URL: 'https://app.wonder.money', NODE_ENV: 'production' })).toEqual(['https://app.wonder.money']);
  });

  it('keeps local CSRF origins available in development and staging', () => {
    expect(getCsrfAllowedOrigins({ APP_ENV: 'development' })).toEqual([
      'http://localhost:8080',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:4321',
    ]);
    expect(getCsrfAllowedOrigins({ APP_ENV: 'staging', APP_URL: 'https://staging.app.wonder.money' })).toEqual([
      'http://localhost:8080',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:4321',
      'https://staging.app.wonder.money',
    ]);
  });

  it('defaults to the configured app origin on a self-hosted instance', () => {
    expect(getCsrfAllowedOrigins({ APP_ENV: 'production', APP_URL: 'https://money.example.com/' })).toEqual(['https://money.example.com']);
  });

  it('falls back to safe defaults when env is unset', () => {
    expect(getCsrfAllowedOrigins({})).toEqual([
      'http://localhost:8080',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:4321',
    ]);
  });

  it('accepts a non-default localhost dev port', () => {
    expect(isCsrfOriginAllowed('http://localhost:3021', {})).toBe(true);
    expect(isCsrfOriginAllowed('http://localhost:9999', { APP_ENV: 'development' })).toBe(true);
  });

  it('does not widen the production allowlist to arbitrary localhost ports', () => {
    expect(isCsrfOriginAllowed('http://localhost:3021', { APP_ENV: 'production', APP_URL: 'https://app.wonder.money' })).toBe(false);
    expect(isCsrfOriginAllowed('http://localhost:3021', { APP_ENV: 'prod', APP_URL: 'https://app.wonder.money', NODE_ENV: 'production' })).toBe(false);
  });

  it('does not widen the staging allowlist to arbitrary localhost ports', () => {
    expect(isCsrfOriginAllowed('http://localhost:3021', { APP_ENV: 'staging', APP_URL: 'https://staging.app.wonder.money' })).toBe(false);
  });

  it('does not widen a request already covered by the fixed dev port list', () => {
    expect(isCsrfOriginAllowed('http://localhost:3000', {})).toBe(true);
  });

  it('rejects non-localhost origins even in development', () => {
    expect(isCsrfOriginAllowed('https://evil.example', {})).toBe(false);
  });

  it('does not widen the allowlist when CSRF_ALLOWED_ORIGINS is explicitly configured', () => {
    expect(
      isCsrfOriginAllowed('http://localhost:3021', { CSRF_ALLOWED_ORIGINS: 'https://one.example' }),
    ).toBe(false);
  });

  it('accepts requests on a non-default dev port end-to-end through csrfOriginProtection', () => {
    const req = createReq({
      get: createHeaderGetter((header: string) => (header === 'Origin' ? 'http://localhost:3021' : undefined)),
    });
    const next = createNext();

    runCsrfOriginProtection(req, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });
});
