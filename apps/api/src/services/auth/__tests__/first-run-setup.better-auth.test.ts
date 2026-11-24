import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The real better-auth, against a real database built from the migrations (its `better_auth`
// schema has no entities). Its pool reads `DB_*` when the module is first imported, so it and
// everything that imports it are imported only once the test database exists.
vi.unmock('@service/auth/better-auth');
vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/email/email', async (importOriginal) => ({
  ...await importOriginal<object>(),
  sendSignupEmail: vi.fn(() => Promise.resolve()),
}));

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { TenantStatus } from '@entity/TenantStatus';

const APP = 'https://app.example.test';
const PASSWORD = 'correct horse battery staple';

/*
 * A new server, from the first visit to its second account: it says it needs setting up until
 * somebody signs up, and that first account is the instance admin while the next is not.
 * Needs a real server (`TEST_POSTGRES_URL`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('first-run setup of a new server', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
  let closePool: () => Promise<void>;
  let app: express.Express;

  beforeAll(async () => {
    const server = new URL(process.env['TEST_POSTGRES_URL'] ?? '');
    Object.assign(process.env, {
      BETTER_AUTH_SECRET: 'first-run-setup-test-secret-0123456789abcd',
      DB_DATABASE: String(db.orm.config.get('dbName')),
      DB_HOST: server.hostname,
      DB_PASSWORD: decodeURIComponent(server.password),
      DB_PORT: server.port || '5432',
      DB_USERNAME: decodeURIComponent(server.username),
    });
    const auth = await import('@service/auth/better-auth');
    const instanceRoutes = (await import('@route/instance')).default;
    const authRoutes = (await import('@route/auth')).default;
    closePool = auth.closeBetterAuthPool;
    app = express();
    app.all('/api/auth/*splat', auth.authHandler);
    app.use(express.json());
    app.use('/v1/instance', instanceRoutes);
    app.use('/v1/auth', authRoutes);
  }, 60_000);

  afterAll(async () => {
    await closePool();
  });

  const setupRequired = async () => (await request(app).get('/v1/instance').expect(200)).body.setupRequired as unknown;

  const signUp = (email: string) =>
    request(app).post('/api/auth/sign-up/email').set('Origin', APP).send({ email, name: email.split('@')[0], password: PASSWORD }).expect(200);

  /** Sign up on the web app and provision the account, as the sign-up form does. */
  const signUpAndProvision = async (email: string) => {
    const cookies = (await signUp(email)).headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    await request(app).post('/v1/auth/callback').set('Origin', APP).set('Cookie', sessionCookie).send({ locale: 'en' }).expect(200);
    return (await db.em().findOneOrFail(Appuser, { emailAddress: email })).accountType;
  };

  it('asks for setup until the first account is provisioned, which makes the instance admin', async () => {
    // The reference data a fresh install seeds.
    const em = db.em();
    em.create(Currency, { code: 'EUR', num: '978' }, { partial: true });
    em.create(TenantStatus, { description: 'Active' }, { partial: true });
    await em.flush();

    expect(await setupRequired()).toBe(true);

    // A login whose app user was never provisioned is not an account yet: setup stays open.
    await signUp('abandoned@example.test');
    expect(await setupRequired()).toBe(true);

    expect(await signUpAndProvision('owner@example.test')).toBe(AppuserAccountType.ADMIN);
    expect(await setupRequired()).toBe(false);

    expect(await signUpAndProvision('partner@example.test')).toBe(AppuserAccountType.REGULAR);
    expect(await setupRequired()).toBe(false);
  });
});
