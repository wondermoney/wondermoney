import { randomUUID } from 'node:crypto';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * `POST /v1/auth/demo` as a client sees it: off by default, then one request signs in the demo
 * account and nobody else, the session it hands out ends after two hours and cannot write, an API
 * token cannot use it, and its own IP-keyed budget bounds it.
 *
 * better-auth is replaced by a double that keeps users and sessions in memory: a session created
 * here is presented back as its cookie and resolves to the user it was created for.
 */

const DEMO_EMAIL = 'demo@wonder.money';

const authState = vi.hoisted(() => ({
  created: [] as { expiresAt: Date; userId: string }[],
  sessions: new Map<string, { createdAt: Date; email: string; userId: string }>(),
  users: new Map<string, { email: string; id: string; twoFactorEnabled: boolean | null }>(),
}));

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => {
  const { mockAuthSession } = await import('@app/__tests__/__helpers__/auth-session-double');
  return {
    ...mockAuthSession(),
    createDemoSession: (input: { expiresAt: Date; userId: string }) => {
      authState.created.push(input);
      const token = `demo-token-${authState.created.length}`;
      const user = authState.users.get(input.userId);
      authState.sessions.set(token, { createdAt: new Date(), email: user?.email ?? '', userId: input.userId });
      return Promise.resolve({
        cookieAttributes: { httpOnly: true, path: '/', sameSite: 'lax', secure: false },
        cookieName: 'better-auth.session_token',
        cookieValue: encodeURIComponent(`${token}.signature`),
        expiresAt: input.expiresAt,
        sessionId: token,
        token,
      });
    },
    deleteExpiredAuthSessions: () => Promise.resolve(),
    findBetterAuthUser: (id: string) => Promise.resolve(authState.users.get(id) ?? null),
    getAuthSession: (headers: Record<string, string | string[] | undefined>) => {
      const cookie = typeof headers['cookie'] === 'string' ? headers['cookie'] : '';
      const token = /better-auth\.session_token=([^.;]+)\./u.exec(cookie)?.[1];
      const session = token ? authState.sessions.get(decodeURIComponent(token)) : undefined;
      if (!session) return Promise.resolve(null);
      return Promise.resolve({
        session: { createdAt: session.createdAt, id: token },
        user: { email: session.email, emailVerified: true, id: session.userId, twoFactorEnabled: false },
      });
    },
  };
});

import { RequestContext } from '@mikro-orm/postgresql';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { DI } from '@app/database/di';
import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Tenant, TenantType } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { errorHandler } from '@middleware/error-handler';
import { demoSignInRateLimit } from '@middleware/rate-limit';
import { authedTenant } from '@middleware/stacks';
import { getUserOptional } from '@middleware/user';
import accountRoutes from '@route/account';
import authRoutes from '@route/auth';
import { DEMO_SESSION_TTL_MS } from '@service/auth/demo-session';
import { ERROR_CODE } from '@utils/errors';

/** The `/v1/auth` and `/v1/account` mounts as `app.ts` wires them (minus the shared `/v1/auth` limiter). */
function buildApp() {
  const app = express();
  app.use((_req, _res, next) => {
    if (!DI.orm) throw new Error('Test database is not started');
    RequestContext.create(DI.orm.em, next);
  });
  app.use(express.json());
  app.use('/v1/auth/demo', demoSignInRateLimit());
  app.use('/v1/auth', getUserOptional, authRoutes);
  app.use('/v1/account', ...authedTenant(), accountRoutes);
  app.use(errorHandler);
  return app;
}

describe('POST /v1/auth/demo', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);

  beforeEach(() => {
    authState.created.length = 0;
    authState.sessions.clear();
    authState.users.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedDemoAccount() {
    const em = db.em();
    const household = await seedHousehold(em);
    authState.users.set(household.appuser.externalUserId, { email: household.appuser.emailAddress, id: household.appuser.externalUserId, twoFactorEnabled: false });
    const demo = em.create(Appuser, {
      accountType: AppuserAccountType.DEMO,
      currencyKey: household.currency,
      emailAddress: demoPersona.email,
      externalUserId: randomUUID(),
      firstName: demoPersona.firstName,
    }, { partial: true });
    const tenant = em.create(Tenant, {
      name: demoPersona.householdName,
      ownerAppuserKey: demo,
      tenantType: TenantType.DEMO,
      tentantStatusKey: em.create(TenantStatus, { description: 'demo-active' }, { partial: true }),
    }, { partial: true });
    em.create(AppuserTenant, { appuserKey: demo, recordActive: true, tenantKey: tenant }, { partial: true });
    await em.flush();
    authState.users.set(demo.externalUserId, { email: DEMO_EMAIL, id: demo.externalUserId, twoFactorEnabled: false });
    return { demo, regular: household.appuser };
  }

  it('is a 404 on a server that did not enable the demo', async () => {
    await seedDemoAccount();

    const res = await request(buildApp()).post('/v1/auth/demo');

    expect(res.status).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(authState.created).toEqual([]);
  });

  it('signs in the demo account, with a two-hour session cookie', async () => {
    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'true');
    const { demo } = await seedDemoAccount();
    const before = Date.now();

    const res = await request(buildApp()).post('/v1/auth/demo');

    expect(res.status).toBe(201);
    expect(authState.created.map((session) => session.userId)).toEqual([demo.externalUserId]);
    const expiresAt = new Date(res.body.session.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + DEMO_SESSION_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + DEMO_SESSION_TTL_MS);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`better-auth.session_token=${res.body.session.cookieValue}`);
    expect(cookie).toMatch(/HttpOnly/u);
    expect(cookie).toContain(`Expires=${new Date(expiresAt).toUTCString()}`);
  });

  it('signs in nobody on a server without a demo account, whoever else exists', async () => {
    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'true');
    const household = await seedHousehold(db.em());
    authState.users.set(household.appuser.externalUserId, { email: household.appuser.emailAddress, id: household.appuser.externalUserId, twoFactorEnabled: false });

    const res = await request(buildApp()).post('/v1/auth/demo').send({ email: household.appuser.emailAddress, userId: household.appuser.externalUserId });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: ERROR_CODE.DEMO_UNAVAILABLE });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(authState.created).toEqual([]);
  });

  it('ignores a user named in the request and signs in the demo account only', async () => {
    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'true');
    const { demo, regular } = await seedDemoAccount();

    const res = await request(buildApp()).post('/v1/auth/demo').send({ email: regular.emailAddress, userId: regular.externalUserId });

    expect(res.status).toBe(201);
    expect(authState.created.map((session) => session.userId)).toEqual([demo.externalUserId]);
  });

  it('refuses a personal API token', async () => {
    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'true');
    await seedDemoAccount();

    const res = await request(buildApp()).post('/v1/auth/demo').set('Authorization', 'Bearer wm_pat_abcdefghijklmnopqrstuvwxyz0123456789ABCD');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: ERROR_CODE.API_TOKEN_SCOPE_REQUIRED });
    expect(authState.created).toEqual([]);
  });

  it('hands out a session that can read the demo household but not write to it', async () => {
    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'true');
    await seedDemoAccount();
    const app = buildApp();
    const signIn = await request(app).post('/v1/auth/demo');
    const cookie = `${signIn.body.session.cookieName}=${signIn.body.session.cookieValue}`;

    const read = await request(app).get('/v1/account').set('Cookie', cookie);
    const write = await request(app).post('/v1/account/offline').set('Cookie', cookie).set('Origin', 'http://localhost:3000').send({ accountName: 'Mine' });

    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ code: ERROR_CODE.DEMO_READ_ONLY });
  });

  it('answers 429 with Retry-After once one address uses up its budget', async () => {
    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'true');
    await seedDemoAccount();
    const app = buildApp();

    for (let i = 0; i < 30; i += 1) {
      expect((await request(app).post('/v1/auth/demo')).status).toBe(201);
    }
    const limited = await request(app).post('/v1/auth/demo');

    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(authState.created).toHaveLength(30);
  });
});
