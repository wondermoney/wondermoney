import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockRes } from '../__tests__/__helpers__/mock-request';

interface MockRequest {
  authUser?: unknown;
  headers: {
    authorization?: string;
    'x-api-key'?: unknown;
    'x-service-api-key'?: unknown;
  };
  ip?: string;
  path?: string;
}

const { mockGetAuthSession } = vi.hoisted(() => ({
  mockGetAuthSession: vi.fn(),
}));

const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

vi.mock('@service/auth/better-auth', () => ({
  getAuthSession: mockGetAuthSession,
}));

vi.mock('@utils/logger', () => ({
  default: mockLogger,
}));

const sessionContext = {
  session: { id: 'session-1' },
  user: {
    email: 'user@example.com',
    emailVerified: true,
    id: 'user-1',
    image: null,
    name: 'Test User',
    twoFactorEnabled: null,
  },
};

describe('auth middleware helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env['ADMIN_API_KEY'] = 'test-admin-key';
    process.env['INTERNAL_SERVICE_API_KEY'] = 'test-internal-service-key';
  });

  it('extracts a bearer token from the authorization header', async () => {
    const { getBearerToken } = await import('./auth-helpers');

    expect(getBearerToken('Bearer token-123')).toBe('token-123');
    expect(getBearerToken(undefined)).toBeNull();
  });

  it('prefers full_name over name when reading auth user names', async () => {
    const { getAuthUserFullName } = await import('../services/auth/auth-callback.utils');

    expect(
      getAuthUserFullName({
        name: 'Full Name',
      }),
    ).toBe('Full Name');
  });

  it('trims the auth user name', async () => {
    const { getAuthUserFullName } = await import('../services/auth/auth-callback.utils');

    expect(getAuthUserFullName({ name: '  Padded Name  ' })).toBe('Padded Name');
  });

  it('returns undefined when the auth user has no name', async () => {
    const { getAuthUserFullName } = await import('../services/auth/auth-callback.utils');

    expect(getAuthUserFullName(undefined)).toBeUndefined();
    expect(getAuthUserFullName({ name: undefined })).toBeUndefined();
  });

  describe('requireAuth', () => {
    it('sets req.authUser and calls next with no error when a session is present', async () => {
      const { requireAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockResolvedValueOnce(sessionContext);

      await requireAuth(req, mockRes(), next);

      expect(mockGetAuthSession).toHaveBeenCalledWith(req.headers);
      expect(req.authUser).toEqual(sessionContext);
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]).toEqual([]);
    });

    it('rejects with UnauthorizedError when no session is found', async () => {
      const { requireAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockResolvedValueOnce(null);

      await requireAuth(req, mockRes(), next);

      expect(req.authUser).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]?.[0]).toMatchObject({
        message: 'No valid session',
        name: 'UnauthorizedError',
      });
    });

    it('rejects with UnauthorizedError when session lookup throws', async () => {
      const { requireAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockRejectedValueOnce(new Error('connection refused'));

      await requireAuth(req, mockRes(), next);

      expect(req.authUser).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]?.[0]).toMatchObject({
        message: 'Session validation failed',
        name: 'UnauthorizedError',
      });
    });
  });

  describe('optionalAuth', () => {
    it('sets req.authUser and calls next with no error when a session is present', async () => {
      const { optionalAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockResolvedValueOnce(sessionContext);

      await optionalAuth(req, mockRes(), next);

      expect(req.authUser).toEqual(sessionContext);
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]).toEqual([]);
    });

    it('calls next with no error and leaves req.authUser undefined when no session is found', async () => {
      const { optionalAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockResolvedValueOnce(null);

      await optionalAuth(req, mockRes(), next);

      expect(req.authUser).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]).toEqual([]);
    });

    it('never throws and calls next with no error when session lookup throws', async () => {
      const { optionalAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockRejectedValueOnce(new Error('connection refused'));

      await optionalAuth(req, mockRes(), next);

      expect(req.authUser).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]).toEqual([]);
    });
  });

  describe('requireBearerAuth', () => {
    it('sets req.authUser and calls next with no error when a session is present', async () => {
      const { requireBearerAuth } = await import('./auth');
      const req = { headers: { authorization: 'Bearer token-123' } } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockResolvedValueOnce(sessionContext);

      await requireBearerAuth(req, mockRes(), next);

      expect(mockGetAuthSession).toHaveBeenCalledWith(req.headers);
      expect(req.authUser).toEqual(sessionContext);
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]).toEqual([]);
    });

    it('rejects with UnauthorizedError when no session is found', async () => {
      const { requireBearerAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockResolvedValueOnce(null);

      await requireBearerAuth(req, mockRes(), next);

      expect(req.authUser).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]?.[0]).toMatchObject({
        name: 'UnauthorizedError',
      });
    });

    it('rejects with UnauthorizedError when session lookup throws', async () => {
      const { requireBearerAuth } = await import('./auth');
      const req = { headers: {} } as unknown as MockRequest & Request;
      const next = vi.fn();
      mockGetAuthSession.mockRejectedValueOnce(new Error('connection refused'));

      await requireBearerAuth(req, mockRes(), next);

      expect(req.authUser).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0]?.[0]).toMatchObject({
        message: 'Session validation failed',
        name: 'UnauthorizedError',
      });
    });
  });

  it('rejects service-auth requests when the internal api key is missing', async () => {
    const { serviceAuth } = await import('./auth');
    delete process.env['INTERNAL_SERVICE_API_KEY'];
    const req = {
      headers: {
        'x-service-api-key': 'some-key',
      },
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    serviceAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: 'Service API key is required',
      name: 'UnauthorizedError',
    });
  });

  it('rejects service-auth requests when the service api key header is missing', async () => {
    const { serviceAuth } = await import('./auth');
    const req = {
      headers: {},
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    serviceAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: 'Service API key is required',
      name: 'UnauthorizedError',
    });
  });

  it('rejects service-auth requests with an invalid service api key header', async () => {
    const { serviceAuth } = await import('./auth');
    const req = {
      headers: {
        'x-service-api-key': 'wrong-key',
      },
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    serviceAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      message: 'Invalid service API key',
      name: 'UnauthorizedError',
    });
  });

  it('allows service-auth requests with a matching service api key header', async () => {
    const { serviceAuth } = await import('./auth');
    const req = {
      headers: {
        'x-service-api-key': 'test-internal-service-key',
      },
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    serviceAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toEqual([]);
  });

  it('accepts admin auth using a JSON key record and exposes its key id', async () => {
    const { adminAuth } = await import('./auth');
    const { createHash } = await import('node:crypto');
    const req = {
      headers: {
        'x-api-key': 'admin-secret',
      },
      ip: '127.0.0.1',
      path: '/v1/admin/users',
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    process.env['ADMIN_API_KEY'] = JSON.stringify([
      {
        hash: createHash('sha256').update('admin-secret').digest('hex'),
        id: 'admin-key-1',
      },
    ]);

    adminAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toEqual([]);
    expect((req as MockRequest & { apiKeyId?: string }).apiKeyId).toBe('admin-key-1');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'admin-key-1', kind: 'admin', path: '/v1/admin/users' }),
      'API key authentication succeeded',
    );
  });

  it('treats non-JSON env api keys as full legacy raw keys even with separators', async () => {
    const { adminAuth } = await import('./auth');
    const req = {
      headers: {
        'x-api-key': 'admin-key-1:admin.secret',
      },
      ip: '127.0.0.1',
      path: '/v1/admin/users',
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    process.env['ADMIN_API_KEY'] = 'admin-key-1:admin.secret';

    adminAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toEqual([]);
    expect((req as MockRequest & { apiKeyId?: string }).apiKeyId).toBeUndefined();
  });

  it('skips malformed hash records and still matches later valid keys', async () => {
    const { createHash } = await import('node:crypto');
    const { serviceAuth } = await import('./auth');
    const req = {
      headers: {
        'x-service-api-key': 'service-secret',
      },
      ip: '127.0.0.1',
      path: '/v1/internal/jobs',
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    process.env['INTERNAL_SERVICE_API_KEY'] = JSON.stringify([
      { hash: 'not-hex', id: 'bad-key' },
      { hash: createHash('sha256').update('service-secret').digest('hex'), id: 'service-key-1' },
    ]);

    serviceAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toEqual([]);
    expect((req as MockRequest & { apiKeyId?: string }).apiKeyId).toBe('service-key-1');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'bad-key', hash: 'not-hex' }),
      'Skipping invalid API key hash record',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'service-key-1', kind: 'service', path: '/v1/internal/jobs' }),
      'API key authentication succeeded',
    );
  });

  it('accepts service auth against a hashed key definition', async () => {
    const { createHash } = await import('node:crypto');
    const { serviceAuth } = await import('./auth');
    const req = {
      headers: {
        'x-service-api-key': 'service-secret',
      },
      ip: '127.0.0.1',
      path: '/v1/internal/jobs',
    } as unknown as MockRequest & Request;
    const next = vi.fn();

    process.env['INTERNAL_SERVICE_API_KEY'] = JSON.stringify([
      {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        hash: createHash('sha256').update('service-secret').digest('hex'),
        id: 'service-key-1',
      },
    ]);

    serviceAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toEqual([]);
    expect((req as MockRequest & { apiKeyId?: string }).apiKeyId).toBe('service-key-1');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyId: 'service-key-1', kind: 'service', path: '/v1/internal/jobs' }),
      'API key authentication succeeded',
    );
  });
});
