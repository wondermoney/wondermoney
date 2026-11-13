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
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { Currency } from '@entity/Currency';

type BetterAuthModule = typeof import('@service/auth/better-auth');

const APP = 'https://app.example.test';

/*
 * The password-reset and verification emails better-auth sends, end to end: they go out in the
 * account's language with their link landing on the app in its locale, a sign-up is mailed in the
 * sign-up page's language before its account exists, and an address with no account gets the same
 * answer and no email. Needs a real server (`TEST_POSTGRES_URL`).
 */
describe.runIf(process.env['TEST_POSTGRES_URL'])('auth emails in the account language', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
  let auth: BetterAuthModule;
  let app: express.Express;

  beforeAll(async () => {
    const server = new URL(process.env['TEST_POSTGRES_URL'] ?? '');
    Object.assign(process.env, {
      AI_REQUIRES_VERIFIED_EMAIL: 'true',
      BETTER_AUTH_SECRET: 'auth-email-language-test-secret-0123456789',
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

  const post = (path: string, body: object) => request(app).post(`/api/auth${path}`).set('Origin', APP).send(body);
  const linkIn = (email: { text: string }) => {
    const link = /https:\/\/api\.example\.test\/api\/auth\/\S+/u.exec(email.text)?.[0];
    if (!link) throw new Error(`No better-auth link in:\n${email.text}`);
    return new URL(link);
  };
  const sentEmail = (index: number) => {
    const email = sent[index];
    if (!email) throw new Error(`Expected email #${index + 1}, ${sent.length} sent`);
    return email;
  };
  const languageOf = (email: { html: string }) => /<html[^>]*lang="([a-z]+)"/u.exec(email.html)?.[1];

  async function accountWith(language: SupportedLanguages) {
    const email = `${randomUUID()}@example.test`;
    const user = await auth.createBetterAuthUser({ email, password: 'correct horse battery staple' });
    const em = db.em();
    const currency = (await em.findOne(Currency, { code: 'EUR' })) ?? em.create(Currency, { code: 'EUR', num: '978' }, { partial: true });
    em.create(Appuser, { currencyKey: currency, emailAddress: email, externalUserId: user.id, firstName: 'Ana', language }, { partial: true });
    await em.flush();
    sent.length = 0;
    return email;
  }

  it.each([
    [SupportedLanguages.PT, 'pt'],
    [SupportedLanguages.ES, 'es'],
  ])('mails a %s account its reset link in %s, landing on the reset page in that locale', async (language, locale) => {
    const email = await accountWith(language);

    const response = await post('/request-password-reset', { email, redirectTo: `${APP}/en/auth/reset` });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sentEmail(0).to).toContain(email);
    expect(languageOf(sentEmail(0))).toBe(locale);
    const link = linkIn(sentEmail(0));
    expect(link.pathname).toMatch(/^\/api\/auth\/reset-password\/[A-Za-z0-9]+$/u);
    expect(link.searchParams.get('callbackURL')).toBe(`${APP}/${locale}/auth/reset`);

    // The link still works: better-auth hands the token to the localized reset page.
    const followed = await request(app).get(`${link.pathname}${link.search}`);
    expect(followed.status).toBe(302);
    expect(followed.headers['location']).toMatch(new RegExp(`^${APP}/${locale}/auth/reset\\?token=`, 'u'));
  });

  it('answers an address without an account exactly as one with, and mails nobody', async () => {
    const email = await accountWith(SupportedLanguages.PT);

    const known = await post('/request-password-reset', { email, redirectTo: `${APP}/pt/auth/reset` });
    const unknown = await post('/request-password-reset', { email: `${randomUUID()}@example.test`, redirectTo: `${APP}/pt/auth/reset` });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(sent).toHaveLength(1);
    expect(sentEmail(0).to).toContain(email);
  });

  it('mails a login without an account in the page language, and in English without one', async () => {
    const email = `${randomUUID()}@example.test`;
    await auth.createBetterAuthUser({ email, password: 'correct horse battery staple' });
    sent.length = 0;

    await post('/request-password-reset', { email, redirectTo: `${APP}/es/auth/reset` });
    await post('/request-password-reset', { email, redirectTo: 'wondermoney://reset-password' });

    expect(sent.map(languageOf)).toEqual(['es', 'en']);
    expect(linkIn(sentEmail(1)).searchParams.get('callbackURL')).toBe('wondermoney://reset-password');
  });

  it("mails a sign-up its verification link in the sign-up page's language before its account exists", async () => {
    const email = `${randomUUID()}@example.test`;

    const response = await post('/sign-up/email', { callbackURL: `${APP}/es`, email, name: 'ana', password: 'correct horse battery staple' });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(languageOf(sentEmail(0))).toBe('es');
    const link = linkIn(sentEmail(0));
    expect(link.pathname).toBe('/api/auth/verify-email');
    expect(link.searchParams.get('token')).toBeTruthy();
    expect(link.searchParams.get('callbackURL')).toBe(`${APP}/es`);
  });

  it('mails a sign-up with no page locale in English, landing on the app', async () => {
    const response = await post('/sign-up/email', { email: `${randomUUID()}@example.test`, name: 'ana', password: 'correct horse battery staple' });

    expect(response.status).toBe(200);
    expect(languageOf(sentEmail(0))).toBe('en');
    expect(linkIn(sentEmail(0)).searchParams.get('callbackURL')).toBe(APP);
  });

  it("resends a verification link in the account's language, landing on the app in its locale", async () => {
    const email = await accountWith(SupportedLanguages.PT);

    const known = await post('/send-verification-email', { email });
    const unknown = await post('/send-verification-email', { email: `${randomUUID()}@example.test` });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(sent).toHaveLength(1);
    expect(languageOf(sentEmail(0))).toBe('pt');
    expect(linkIn(sentEmail(0)).searchParams.get('callbackURL')).toBe(`${APP}/pt`);
  });
});
