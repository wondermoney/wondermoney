import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyTotpForSession } = vi.hoisted(() => ({ verifyTotpForSession: vi.fn() }));

vi.mock('@service/auth/better-auth', () => ({ verifyTotpForSession }));

const { requireSensitiveSession, SENSITIVE_SESSION_MAX_AGE_MS } = await import('@middleware/sensitive-session');

function request(overrides: {
  apiToken?: boolean;
  createdAt?: Date;
  totpCode?: string;
  twoFactorEnabled?: boolean;
} = {}): Request {
  return {
    apiToken: overrides.apiToken ? { apiTokenKey: 1, scopes: ['read'] } : undefined,
    authUser: {
      session: { createdAt: overrides.createdAt ?? new Date(), id: 'session-1' },
      user: {
        email: 'user@example.test',
        emailVerified: true,
        id: 'user-1',
        twoFactorEnabled: overrides.twoFactorEnabled ?? false,
      },
    },
    get: (header: string) => (header.toLowerCase() === 'x-totp-code' ? overrides.totpCode : undefined),
    headers: {},
  } as unknown as Request;
}

function run(req: Request) {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  return requireSensitiveSession(req, {} as Response, next).then(() => next);
}

describe('requireSensitiveSession', () => {
  beforeEach(() => {
    verifyTotpForSession.mockReset();
    verifyTotpForSession.mockResolvedValue(undefined);
  });

  it('rejects a personal API token outright', async () => {
    const next = await run(request({ apiToken: true }));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'api_token_scope_required' }));
  });

  it('accepts a fresh session without MFA', async () => {
    const next = await run(request());

    expect(next).toHaveBeenCalledWith();
    expect(verifyTotpForSession).not.toHaveBeenCalled();
  });

  it('rejects a session older than the freshness window', async () => {
    const next = await run(request({ createdAt: new Date(Date.now() - SENSITIVE_SESSION_MAX_AGE_MS - 1_000) }));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'session_not_fresh' }));
  });

  it('requires a TOTP code when the user has MFA enabled', async () => {
    const next = await run(request({ twoFactorEnabled: true }));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'totp_required' }));
    expect(verifyTotpForSession).not.toHaveBeenCalled();
  });

  it('rejects an invalid TOTP code', async () => {
    verifyTotpForSession.mockRejectedValueOnce(new Error('invalid code'));

    const next = await run(request({ totpCode: '000000', twoFactorEnabled: true }));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_totp' }));
  });

  it('accepts a valid TOTP code', async () => {
    const next = await run(request({ totpCode: '123456', twoFactorEnabled: true }));

    expect(verifyTotpForSession).toHaveBeenCalledWith({}, '123456');
    expect(next).toHaveBeenCalledWith();
  });
});
