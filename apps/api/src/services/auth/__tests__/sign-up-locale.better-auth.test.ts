import { randomUUID } from 'node:crypto';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The real better-auth, against a real database built from the migrations (its `better_auth`
// schema has no entities). Its pool reads `DB_*` and `sendOnSignUp` reads
// `AI_REQUIRES_VERIFIED_EMAIL` when the module is first imported, so it is imported only once the
// test database exists. Mail leaves through a captured transport instead of the log driver.
vi.unmock('@service/auth/better-auth');

const sent = vi.hoisted(() => [] as { html: string; subject: string; text: string; to: string }[]);
vi.mock('@config/env', async (importOriginal) => ({ ...await importOriginal<object>(), SHOULD_INTERCEPT_EMAILS: false }));
vi.mock('@service/email/email-transport', async (importOriginal) => ({
  ...await importOriginal<object>(),
  resolveEmailDriver: () => 'smtp',
  sendWithTransport: vi.fn((message: { html: string; subject: string; text: string; to: string }) => {
    sent.push(message);
    return Promise.resolve({ providerMessageIds: [randomUUID()], type: 'accepted' });
  }),
}));

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

type BetterAuthModule = typeof import('@service/auth/better-auth');

const APP = 'https://app.example.test';
const PASSWORD = 'correct horse battery staple';

/*
 * A sign-up from the mobile app names no page, so it says its language in `Accept-Language`: the
 * verification email better-auth sends before the account exists then carries the same localized
 * app callback a web sign-up sends, goes out in that language (auth-email-language.ts), and its
 * link still verifies the address and lands on the app.
 * Needs a real server (`TEST_POSTGRES_URL`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('sign-up locale from Accept-Language', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
  let auth: BetterAuthModule;
  let app: express.Express;

  beforeAll(async () => {
    const server = new URL(process.env['TEST_POSTGRES_URL'] ?? '');
    Object.assign(process.env, {
      AI_REQUIRES_VERIFIED_EMAIL: 'true',
      BETTER_AUTH_SECRET: 'sign-up-locale-test-secret-0123456789abcd',
      DB_DATABASE: String(db.orm.config.get('dbName')),
      DB_HOST: server.hostname,
      DB_PASSWORD: decodeURIComponent(server.password),
      DB_PORT: server.port || '5432',
      DB_USERNAME: decodeURIComponent(server.username),
    });
    auth = await import('@service/auth/better-auth');
    app = express();
    app.all('/api/auth/*splat', auth.authHandler);
  }, 60_000);

  afterAll(async () => {
    await auth.closeBetterAuthPool();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  /** What the Expo client sends: no browser `Origin`, its scheme as `expo-origin`, no callback. */
  const mobileSignUp = (email: string, acceptLanguage?: string) => {
    const call = request(app).post('/api/auth/sign-up/email').set('expo-origin', 'wondermoney://');
    return (acceptLanguage ? call.set('Accept-Language', acceptLanguage) : call).send({ email, name: 'ana', password: PASSWORD });
  };
  const verificationLink = () => {
    expect(sent).toHaveLength(1);
    const link = /https:\/\/api\.example\.test\/api\/auth\/verify-email\S+/u.exec(sent[0]?.text ?? '')?.[0];
    if (!link) throw new Error(`No verification link in:\n${sent[0]?.text ?? '(no email)'}`);
    return new URL(link);
  };
  const languageOf = (email: undefined | { html: string }) => /<html[^>]*lang="([a-z]+)"/u.exec(email?.html ?? '')?.[1];
  const isVerified = async (email: string) => {
    const [row] = await db.em().getConnection().execute<{ emailVerified: boolean }[]>(
      'select "emailVerified" from better_auth."user" where email = ?',
      [email],
    );
    return row?.emailVerified;
  };

  it.each([
    ['pt-PT', 'pt'],
    ['es', 'es'],
  ])('mails a mobile sign-up in %s its verification in %s, landing on the app in that locale and verifying the address', async (acceptLanguage, locale) => {
    const email = `${randomUUID()}@example.test`;

    const response = await mobileSignUp(email, acceptLanguage);

    expect(response.status).toBe(200);
    const link = verificationLink();
    expect(languageOf(sent[0])).toBe(locale);
    expect(link.searchParams.get('callbackURL')).toBe(`${APP}/${locale}`);
    expect(await isVerified(email)).toBe(false);

    const followed = await request(app).get(`${link.pathname}${link.search}`);

    expect(followed.status).toBe(302);
    expect(followed.headers['location']).toBe(`${APP}/${locale}`);
    expect(await isVerified(email)).toBe(true);
  });

  it.each([[undefined], ['fr-FR']])('mails a mobile sign-up with Accept-Language %s in English, landing on the app as before', async (acceptLanguage) => {
    const email = `${randomUUID()}@example.test`;

    const response = await mobileSignUp(email, acceptLanguage);

    expect(response.status).toBe(200);
    const link = verificationLink();
    expect(languageOf(sent[0])).toBe('en');
    expect(link.searchParams.get('callbackURL')).toBe(APP);
    const followed = await request(app).get(`${link.pathname}${link.search}`);
    expect(followed.headers['location']).toBe(APP);
    expect(await isVerified(email)).toBe(true);
  });

  it('keeps the callback a web sign-up chose, whatever its Accept-Language', async () => {
    const response = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', APP)
      .set('Accept-Language', 'es')
      .send({ callbackURL: `${APP}/en`, email: `${randomUUID()}@example.test`, name: 'ana', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(verificationLink().searchParams.get('callbackURL')).toBe(`${APP}/en`);
    expect(languageOf(sent[0])).toBe('en');
  });
});
