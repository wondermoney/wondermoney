import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { Tenant, TenantType } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { DEMO_SESSION_TTL_MS } from '@service/auth/demo-session';
import { type DemoSessionPort, signInToDemo } from '@service/auth/demo-sign-in.service';

/*
 * The demo sign-in resolves the account on the server and signs in nobody unless every check
 * holds. These run the real identity queries against Postgres; only better-auth is replaced, by a
 * port that records which user a session was created for.
 */

const NOW = new Date('2026-11-12T10:00:00.000Z');

interface AuthUser { email: string; id: string; twoFactorEnabled: boolean | null }

function fakeSessions(users: AuthUser[]) {
  const created: { expiresAt: Date; userId: string }[] = [];
  const cleaned: string[] = [];
  const port: DemoSessionPort = {
    createSession: (input) => {
      created.push(input);
      return Promise.resolve({
        cookieAttributes: { httpOnly: true, path: '/', sameSite: 'lax', secure: true },
        cookieName: 'better-auth.session_token',
        cookieValue: 'token.signature',
        expiresAt: input.expiresAt,
        sessionId: `session-${created.length}`,
        token: 'token',
      });
    },
    deleteExpiredSessions: (userId) => {
      cleaned.push(userId);
      return Promise.resolve();
    },
    findUser: (userId) => Promise.resolve(users.find((user) => user.id === userId) ?? null),
  };
  return { cleaned, created, port };
}

async function seedDemo(em: EntityManager, overrides: { email?: string; externalUserId?: string } = {}) {
  const currency = (await em.findOne(Currency, { code: 'EUR' })) ?? em.create(Currency, { code: 'EUR', num: '978' }, { partial: true });
  const tenantStatus = em.create(TenantStatus, { description: `active-${randomUUID()}` }, { partial: true });
  const appuser = em.create(Appuser, {
    accountType: AppuserAccountType.DEMO,
    currencyKey: currency,
    emailAddress: overrides.email ?? demoPersona.email,
    externalUserId: overrides.externalUserId ?? randomUUID(),
    firstName: demoPersona.firstName,
  }, { partial: true });
  const tenant = em.create(Tenant, {
    name: demoPersona.householdName,
    ownerAppuserKey: appuser,
    tenantType: TenantType.DEMO,
    tentantStatusKey: tenantStatus,
  }, { partial: true });
  em.create(AppuserTenant, { appuserKey: appuser, recordActive: true, tenantKey: tenant }, { partial: true });
  await em.flush();
  return { appuser, demoAuthUser: { email: demoPersona.email, id: appuser.externalUserId, twoFactorEnabled: false }, tenant };
}

describe('signing in to the demo', () => {
  const db = useTestDatabase();

  it('does nothing while the instance has the demo off', async () => {
    const em = db.em();
    const { demoAuthUser } = await seedDemo(em);
    const sessions = fakeSessions([demoAuthUser]);

    const result = await signInToDemo({ em, enabled: false, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ status: 'disabled' });
    expect(sessions.created).toEqual([]);
  });

  it('signs in the demo account, for two hours, and clears its expired sessions', async () => {
    const em = db.em();
    await seedHousehold(em);
    const { demoAuthUser } = await seedDemo(em);
    const sessions = fakeSessions([demoAuthUser]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result.status).toBe('signed-in');
    expect(sessions.created).toEqual([{ expiresAt: new Date(NOW.getTime() + DEMO_SESSION_TTL_MS), userId: demoAuthUser.id }]);
    expect(sessions.cleaned).toEqual([demoAuthUser.id]);
  });

  it('signs in nobody when the only account is a regular one', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    const sessions = fakeSessions([{ email: appuser.emailAddress, id: appuser.externalUserId, twoFactorEnabled: false }]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'missing-demo-appuser', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });

  it('signs in nobody when the demo row points at somebody else’s login', async () => {
    const em = db.em();
    const { appuser: regular } = await seedHousehold(em);
    await seedDemo(em, { externalUserId: regular.externalUserId });
    const sessions = fakeSessions([{ email: regular.emailAddress, id: regular.externalUserId, twoFactorEnabled: false }]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'auth-user-mismatch', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });

  it('signs in nobody when the demo row’s address was changed', async () => {
    const em = db.em();
    const { demoAuthUser } = await seedDemo(em, { email: 'someone@example.test' });
    const sessions = fakeSessions([demoAuthUser]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result.status).toBe('unavailable');
    expect(sessions.created).toEqual([]);
  });

  it('signs in nobody when a regular user was turned into a demo account', async () => {
    const em = db.em();
    const { appuser } = await seedHousehold(em);
    appuser.accountType = AppuserAccountType.DEMO;
    await em.flush();
    const sessions = fakeSessions([{ email: appuser.emailAddress, id: appuser.externalUserId, twoFactorEnabled: false }]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result.status).toBe('unavailable');
    expect(sessions.created).toEqual([]);
  });

  it('signs in nobody when the demo login’s own address is not the demo address', async () => {
    const em = db.em();
    const { demoAuthUser } = await seedDemo(em);
    const sessions = fakeSessions([{ ...demoAuthUser, email: 'owner@example.test' }]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'auth-user-mismatch', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });

  it('signs in nobody when the demo login is gone', async () => {
    const em = db.em();
    await seedDemo(em);
    const sessions = fakeSessions([]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'missing-auth-user', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });

  it('refuses a demo account with TOTP', async () => {
    const em = db.em();
    const { demoAuthUser } = await seedDemo(em);
    const sessions = fakeSessions([{ ...demoAuthUser, twoFactorEnabled: true }]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'two-factor-enabled', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });

  it('refuses when a real person was added to the demo household', async () => {
    const em = db.em();
    const { demoAuthUser, tenant } = await seedDemo(em);
    const { appuser: regular } = await seedHousehold(em);
    em.create(AppuserTenant, { appuserKey: regular, recordActive: true, role: HouseholdRole.MEMBER, tenantKey: tenant }, { partial: true });
    await em.flush();
    const sessions = fakeSessions([demoAuthUser]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'demo-household-shared', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });

  it('refuses when the demo account was added to a real household', async () => {
    const em = db.em();
    const { appuser, demoAuthUser } = await seedDemo(em);
    const household = await seedHousehold(em);
    em.create(AppuserTenant, { appuserKey: appuser, recordActive: true, role: HouseholdRole.MEMBER, tenantKey: household.tenant }, { partial: true });
    await em.flush();
    const sessions = fakeSessions([demoAuthUser]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'demo-household-shared', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });

  it('refuses when there are two demo households', async () => {
    const em = db.em();
    const { appuser, demoAuthUser } = await seedDemo(em);
    em.create(Tenant, {
      name: demoPersona.householdName,
      ownerAppuserKey: appuser,
      tenantType: TenantType.DEMO,
      tentantStatusKey: em.create(TenantStatus, { description: 'second' }, { partial: true }),
    }, { partial: true });
    await em.flush();
    const sessions = fakeSessions([demoAuthUser]);

    const result = await signInToDemo({ em, enabled: true, now: NOW, sessions: sessions.port });

    expect(result).toEqual({ reason: 'ambiguous-demo-identity', status: 'unavailable' });
    expect(sessions.created).toEqual([]);
  });
});
