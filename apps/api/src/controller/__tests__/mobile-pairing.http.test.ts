import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  sessions: new Map<string, { createdAt: Date; expiresAt: Date; id: string; ipAddress: null | string; updatedAt: Date; userAgent: null | string }>(),
  totpValid: true,
  twoFactorEnabled: false,
}));

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => {
  const { mockAuthSession } = await import('@app/__tests__/__helpers__/auth-session-double');
  const base = mockAuthSession();
  return {
    ...base,
    createPairedSession: (input: { userAgent?: null | string }) => {
      const id = `paired-${authState.sessions.size + 1}`;
      authState.sessions.set(id, {
        createdAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-08T00:00:00Z'),
        id,
        ipAddress: null,
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        userAgent: input.userAgent ?? null,
      });
      return Promise.resolve({
        cookieName: 'better-auth.session_token',
        cookieValue: `signed-${id}`,
        expiresAt: new Date('2026-01-08T00:00:00Z'),
        sessionId: id,
        token: `token-${id}`,
      });
    },
    deleteAuthSession: (id: string) => {
      authState.sessions.delete(id);
      return Promise.resolve();
    },
    getAuthSession: async (headers: Record<string, string | string[] | undefined>) => {
      const session = await base.getAuthSession(headers);
      return session ? { ...session, user: { ...session.user, twoFactorEnabled: authState.twoFactorEnabled } } : null;
    },
    listAuthSessions: (ids: string[]) => Promise.resolve(ids.flatMap((id) => authState.sessions.get(id) ?? [])),
    verifyTotpForSession: () => {
      if (!authState.totpValid) return Promise.reject(new Error('invalid code'));
      return Promise.resolve();
    },
  };
});

import { RequestContext } from '@mikro-orm/postgresql';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { DI } from '@app/database/di';
import { errorHandler } from '@middleware/error-handler';
import { pairingRateLimit } from '@middleware/rate-limit';
import authRoutes from '@route/auth';
import userRoutes from '@route/user';

/*
 * The pairing endpoints as the clients see them: a signed-in web session mints a code (with the
 * same fresh-session/TOTP gate as token creation), the phone trades it for a session, and the
 * device list can revoke it. The exchange is public, so its own strict per-IP family bounds it.
 */
describe('QR pairing over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/user', userRoutes);

  /** The public `/v1/auth` mount, as `app.ts` wires it (minus the mount-level exchange limiter). */
  const publicAuth = () => {
    const app = express();
    app.use((_req, _res, next) => {
      if (!DI.orm) throw new Error('Test database is not started');
      RequestContext.create(DI.orm.em, next);
    });
    app.use(express.json());
    app.use('/v1/auth', pairingRateLimit(), authRoutes);
    app.use(errorHandler);
    return request(app);
  };

  const mintCode = async (user: Parameters<ReturnType<typeof tenantHttp>['as']>[0]) => {
    const response = await http.as(user).post('/v1/user/pairing-codes');
    expect(response.status).toBe(201);
    return response.body.pairingCode as { code: string; expiresAt: string; url: string };
  };

  it('mints a QR payload that names this server and carries no long-lived secret', async () => {
    const { appuser } = await seedHousehold(db.em());

    const pairingCode = await mintCode(appuser);

    expect(pairingCode.url).toBe(`wondermoney://pair?code=${encodeURIComponent(pairingCode.code)}&server=${encodeURIComponent('https://api.example.test')}`);
    expect(new Date(pairingCode.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('requires a fresh session, and a TOTP code for an account that has one', async () => {
    const { appuser } = await seedHousehold(db.em());
    authState.twoFactorEnabled = true;
    try {
      const withoutCode = await http.as(appuser).post('/v1/user/pairing-codes');
      expect(withoutCode.status).toBe(403);
      expect(withoutCode.body.code).toBe('totp_required');

      authState.totpValid = false;
      const wrongCode = await http.as(appuser).post('/v1/user/pairing-codes').set('x-totp-code', '000000');
      expect(wrongCode.status).toBe(403);
      expect(wrongCode.body.code).toBe('invalid_totp');

      authState.totpValid = true;
      const paired = await http.as(appuser).post('/v1/user/pairing-codes').set('x-totp-code', '123456');
      expect(paired.status).toBe(201);
    } finally {
      authState.twoFactorEnabled = false;
      authState.totpValid = true;
    }
  });

  it('exchanges a code for a session the phone can store, then lists and revokes the device', async () => {
    const { appuser } = await seedHousehold(db.em());
    const pairingCode = await mintCode(appuser);
    const auth = publicAuth();

    const paired = await auth
      .post('/v1/auth/pair')
      .set('user-agent', 'WonderMoney/1.0.2 (iOS 18.0)')
      .send({ code: pairingCode.code });

    expect(paired.status).toBe(201);
    expect(paired.body.session).toEqual(expect.objectContaining({
      cookieName: 'better-auth.session_token',
      cookieValue: expect.stringContaining('signed-'),
    }));
    const sessionId = paired.body.device.id as string;

    const devices = await http.as(appuser).get('/v1/user/devices');
    expect(devices.status).toBe(200);
    expect(devices.body.devices).toEqual([
      expect.objectContaining({ id: sessionId, label: 'WonderMoney/1.0.2 (iOS 18.0)' }),
    ]);

    expect((await http.as(appuser).delete(`/v1/user/devices/${sessionId}`)).status).toBe(204);
    expect((await http.as(appuser).get('/v1/user/devices')).body.devices).toEqual([]);
    expect(authState.sessions.has(sessionId)).toBe(false);
  });

  it('refuses a code that was already used, and one that never existed', async () => {
    const { appuser } = await seedHousehold(db.em());
    const pairingCode = await mintCode(appuser);
    const auth = publicAuth();

    expect((await auth.post('/v1/auth/pair').send({ code: pairingCode.code })).status).toBe(201);

    const reused = await auth.post('/v1/auth/pair').send({ code: pairingCode.code });
    expect(reused.status).toBe(404);
    expect(reused.body.code).toBe('pairing_code_invalid');

    const unknown = await auth.post('/v1/auth/pair').send({ code: 'not-a-real-pairing-code' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('pairing_code_invalid');
  });

  it('rate-limits the public exchange per address', async () => {
    const auth = publicAuth();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await auth.post('/v1/auth/pair').send({ code: 'not-a-real-pairing-code' })).status).toBe(404);
    }
    const limited = await auth.post('/v1/auth/pair').send({ code: 'not-a-real-pairing-code' });

    expect(limited.status).toBe(429);
    expect(limited.body.family).toBe('pairing');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it("lists only the caller's devices", async () => {
    const first = await seedHousehold(db.em());
    const second = await seedHousehold(db.em());
    const pairingCode = await mintCode(first.appuser);
    await publicAuth().post('/v1/auth/pair').send({ code: pairingCode.code });

    expect((await http.as(first.appuser).get('/v1/user/devices')).body.devices).toHaveLength(1);
    expect((await http.as(second.appuser).get('/v1/user/devices')).body.devices).toEqual([]);
  });

  it('answers 404 when revoking a device that is not the caller’s', async () => {
    const first = await seedHousehold(db.em());
    const second = await seedHousehold(db.em());
    const pairingCode = await mintCode(first.appuser);
    const paired = await publicAuth().post('/v1/auth/pair').send({ code: pairingCode.code });
    const sessionId = paired.body.device.id as string;

    const refused = await http.as(second.appuser).delete(`/v1/user/devices/${sessionId}`);

    expect(refused.status).toBe(404);
    expect(authState.sessions.has(sessionId)).toBe(true);
  });
});
