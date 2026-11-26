import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyTotpForSession } = vi.hoisted(() => ({ verifyTotpForSession: vi.fn() }));

vi.mock('@service/auth/better-auth', () => ({ verifyTotpForSession }));

const { requireSensitiveSession, resetSensitiveSessionTotpFailures, SENSITIVE_SESSION_MAX_AGE_MS } = await import('@middleware/sensitive-session');

const RIGHT_CODE = '123456';

function request(overrides: {
  apiToken?: boolean;
  createdAt?: Date;
  ip?: string;
  totpCode?: string;
  twoFactorEnabled?: boolean;
  userId?: string;
} = {}): Request {
  return {
    apiToken: overrides.apiToken ? { apiTokenKey: 1, scopes: ['read'] } : undefined,
    authUser: {
      session: { createdAt: overrides.createdAt ?? new Date(), id: 'session-1' },
      user: {
        email: 'user@example.test',
        emailVerified: true,
        id: overrides.userId ?? 'user-1',
        twoFactorEnabled: overrides.twoFactorEnabled ?? false,
      },
    },
    baseUrl: '/v1/user',
    get: (header: string) => (header.toLowerCase() === 'x-totp-code' ? overrides.totpCode : undefined),
    headers: {},
    ip: overrides.ip ?? '192.0.2.10',
    method: 'POST',
    path: '/api-tokens',
  } as unknown as Request;
}

/** What the middleware answered: passed on (`next`), or sent a response itself (a 429). */
async function run(req: Request) {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  const sent: { body?: unknown; headers: Record<string, string>; status?: number } = { headers: {} };
  const res = {
    json: (body: unknown) => { sent.body = body; return res; },
    setHeader: (name: string, value: string) => { sent.headers[name.toLowerCase()] = value; return res; },
    status: (status: number) => { sent.status = status; return res; },
  } as unknown as Response;
  await requireSensitiveSession(req, res, next);
  return Object.assign(next, { sent });
}

/** Someone with two-factor on, entering `code`. */
const withCode = (code: string | undefined, overrides: Parameters<typeof request>[0] = {}) =>
  run(request({ totpCode: code, twoFactorEnabled: true, ...overrides }));

describe('requireSensitiveSession', () => {
  beforeEach(async () => {
    verifyTotpForSession.mockReset();
    verifyTotpForSession.mockImplementation((_headers: unknown, code: string) => (code === RIGHT_CODE ? Promise.resolve() : Promise.reject(new Error('invalid code'))));
    await resetSensitiveSessionTotpFailures();
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

  describe('guessing the authenticator code', () => {
    it('refuses the sixth try after five wrong codes with 429, even with the right code, without checking it', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(await withCode('000000')).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_totp' }));
      }
      verifyTotpForSession.mockClear();

      const sixth = await withCode(RIGHT_CODE);

      expect(sixth).not.toHaveBeenCalled();
      expect(sixth.sent.status).toBe(429);
      expect(Number(sixth.sent.headers['retry-after'])).toBeGreaterThan(0);
      expect(verifyTotpForSession).not.toHaveBeenCalled();
    });

    it("leaves another person's budget alone", async () => {
      for (let attempt = 0; attempt < 5; attempt++) await withCode('000000');
      expect((await withCode(RIGHT_CODE)).sent.status).toBe(429);

      // Same address, another account: their own code still works.
      expect(await withCode(RIGHT_CODE, { userId: 'user-2' })).toHaveBeenCalledWith();
    });

    it('keeps counting after a right code: the window, not a success, clears it', async () => {
      for (let attempt = 0; attempt < 4; attempt++) await withCode('000000');
      expect(await withCode(RIGHT_CODE)).toHaveBeenCalledWith();
      expect(await withCode('000000')).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_totp' }));

      expect((await withCode(RIGHT_CODE)).sent.status).toBe(429);
    });

    it('does not count a missing code', async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        expect(await withCode(undefined)).toHaveBeenCalledWith(expect.objectContaining({ code: 'totp_required' }));
      }

      expect(await withCode(RIGHT_CODE)).toHaveBeenCalledWith();
    });

    it('still answers session_not_fresh first for a stale session over its budget', async () => {
      for (let attempt = 0; attempt < 5; attempt++) await withCode('000000');

      const stale = await withCode(RIGHT_CODE, { createdAt: new Date(Date.now() - SENSITIVE_SESSION_MAX_AGE_MS - 1_000) });

      expect(stale).toHaveBeenCalledWith(expect.objectContaining({ code: 'session_not_fresh' }));
      expect(stale.sent.status).toBeUndefined();
    });

    it('limits wrong codes from one address across accounts to 30', async () => {
      for (let user = 1; user <= 6; user++) {
        for (let attempt = 0; attempt < 5; attempt++) await withCode('000000', { userId: `user-${user}` });
      }

      // A seventh account from the same address is refused before its code is checked.
      expect((await withCode(RIGHT_CODE, { userId: 'user-7' })).sent.status).toBe(429);
      expect(await withCode(RIGHT_CODE, { ip: '198.51.100.20', userId: 'user-8' })).toHaveBeenCalledWith();
    });
  });
});
