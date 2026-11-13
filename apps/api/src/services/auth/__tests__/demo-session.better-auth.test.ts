import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The real better-auth, against a real database built from the migrations (its `better_auth`
// schema has no entities). The module builds its pool from `DB_*` when it is first imported, so it
// is imported only once the test database exists.
vi.unmock('@service/auth/better-auth');

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { Tenant, TenantType } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { DEMO_SESSION_TTL_MS } from '@service/auth/demo-session';

type BetterAuthModule = typeof import('@service/auth/better-auth');
type DemoSignInModule = typeof import('@service/auth/demo-sign-in.service');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/*
 * What better-auth itself does with a demo session: it is created for the demo account with a
 * two-hour expiry, a refresh (which better-auth would otherwise slide to seven days) keeps it inside
 * those two hours, and once they are up the session is gone. A regular session still slides.
 * Needs a real server (`TEST_POSTGRES_URL`): the harness builds the `better_auth` schema only there.
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('demo sessions in better-auth', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
  let auth: BetterAuthModule;
  let demoSignIn: DemoSignInModule;

  beforeAll(async () => {
    const server = new URL(process.env['TEST_POSTGRES_URL'] ?? '');
    Object.assign(process.env, {
      BETTER_AUTH_SECRET: 'demo-session-test-secret-0123456789abcdef',
      DB_DATABASE: String(db.orm.config.get('dbName')),
      DB_HOST: server.hostname,
      DB_PASSWORD: decodeURIComponent(server.password),
      DB_PORT: server.port || '5432',
      DB_USERNAME: decodeURIComponent(server.username),
    });
    auth = await import('@service/auth/better-auth');
    demoSignIn = await import('@service/auth/demo-sign-in.service');
  }, 60_000);

  afterAll(async () => {
    await auth.closeBetterAuthPool();
  });

  const sql = <T extends object>(text: string, values: unknown[] = []) => db.em().getConnection().execute<T[]>(text, values);
  const sessionRow = async (id: string) => {
    const [row] = await sql<{ createdAt: Date | string; expiresAt: Date | string }>('select "createdAt", "expiresAt" from better_auth.session where id = ?', [id]);
    return row ? { createdAt: new Date(row.createdAt), expiresAt: new Date(row.expiresAt) } : undefined;
  };
  const cookieOf = (session: { cookieName: string; cookieValue: string }) => ({ cookie: `${session.cookieName}=${session.cookieValue}` });

  async function seedDemoIdentity(externalUserId: string) {
    const em = db.em();
    const currency = em.create(Currency, { code: 'EUR', num: '978' }, { partial: true });
    const appuser = em.create(Appuser, { accountType: AppuserAccountType.DEMO, currencyKey: currency, emailAddress: demoPersona.email, externalUserId, firstName: demoPersona.firstName }, { partial: true });
    const tenant = em.create(Tenant, { name: demoPersona.householdName, ownerAppuserKey: appuser, tenantType: TenantType.DEMO, tentantStatusKey: em.create(TenantStatus, { description: 'active' }, { partial: true }) }, { partial: true });
    em.create(AppuserTenant, { appuserKey: appuser, recordActive: true, tenantKey: tenant }, { partial: true });
    await em.flush();
  }

  it('signs in the demo account for two hours, and a refresh does not extend it', async () => {
    const demoUser = await auth.ensureDemoAuthUser({ email: demoPersona.email, name: 'Sofia Martins' });
    await seedDemoIdentity(demoUser.id);

    const result = await demoSignIn.signInToDemo({ em: db.em(), enabled: true });
    if (result.status !== 'signed-in') throw new Error(`Expected a demo session, got ${JSON.stringify(result)}`);

    const resolved = await auth.getAuthSession(cookieOf(result.session));
    expect(resolved?.user).toMatchObject({ email: demoPersona.email, id: demoUser.id });

    const row = await sessionRow(result.session.sessionId);
    if (!row) throw new Error('The demo session row is missing');
    // `getAuthSession` ran better-auth's refresh; the expiry is still two hours after the start.
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(DEMO_SESSION_TTL_MS + 1000);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + DEMO_SESSION_TTL_MS - 60_000);
  });

  it('ends a demo session two hours after it started, whatever its expiry says', async () => {
    const demoUser = await auth.ensureDemoAuthUser({ email: demoPersona.email, name: 'Sofia Martins' });
    const session = await auth.createDemoSession({ expiresAt: new Date(Date.now() + 7 * DAY_MS), userId: demoUser.id });
    await sql('update better_auth.session set "createdAt" = ? where id = ?', [new Date(Date.now() - 3 * HOUR_MS), session.sessionId]);

    expect(await auth.getAuthSession(cookieOf(session))).toBeNull();
    expect(await sessionRow(session.sessionId)).toBeUndefined();
  });

  it('still slides a regular session forward', async () => {
    const regular = await auth.createBetterAuthUser({ email: `owner-${randomUUID()}@example.test`, password: 'correct horse battery staple' });
    const session = await auth.createPairedSession({ userId: regular.id });
    await sql('update better_auth.session set "createdAt" = ?, "expiresAt" = ? where id = ?', [new Date(Date.now() - 3 * DAY_MS), new Date(Date.now() + 4 * DAY_MS), session.sessionId]);

    expect((await auth.getAuthSession(cookieOf(session)))?.user.id).toBe(regular.id);
    const row = await sessionRow(session.sessionId);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY_MS);
  });

  it('puts the demo login back in its demo state, and keeps its id', async () => {
    const first = await auth.ensureDemoAuthUser({ email: demoPersona.email, name: 'Sofia Martins' });
    await sql('update better_auth."user" set "twoFactorEnabled" = true, name = ? where id = ?', ['Changed', first.id]);
    await sql('insert into better_auth."twoFactor" (id, secret, "backupCodes", "userId") values (?, ?, ?, ?)', [randomUUID(), 'secret', 'codes', first.id]);
    expect((await auth.findBetterAuthUser(first.id))?.twoFactorEnabled).toBe(true);

    const second = await auth.ensureDemoAuthUser({ email: demoPersona.email, name: 'Sofia Martins' });

    expect(second).toEqual({ created: false, id: first.id });
    expect(await auth.findBetterAuthUser(first.id)).toEqual({ email: demoPersona.email, id: first.id, twoFactorEnabled: false });
    expect(await sql('select 1 from better_auth."twoFactor" where "userId" = ?', [first.id])).toEqual([]);
  });

  it('cleans up only sessions that are already over', async () => {
    const demoUser = await auth.ensureDemoAuthUser({ email: demoPersona.email, name: 'Sofia Martins' });
    const over = await auth.createDemoSession({ expiresAt: new Date(Date.now() - 1000), userId: demoUser.id });
    const live = await auth.createDemoSession({ expiresAt: new Date(Date.now() + HOUR_MS), userId: demoUser.id });

    await auth.deleteExpiredAuthSessions(demoUser.id);

    expect(await sessionRow(over.sessionId)).toBeUndefined();
    expect(await sessionRow(live.sessionId)).toBeDefined();
  });
});
