import { createHmac } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { symmetricEncrypt } from 'better-auth/crypto';
import { bearer, twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';

import { passkeyPlugins, passkeyRelyingParty } from '../passkey';
import { TWO_FACTOR_COOKIE_MAX_AGE_SECONDS, twoFactorOAuthGuard } from '../two-factor-oauth-guard';

import { type AuthenticationOptions, type RegistrationOptions, softAuthenticator } from './__helpers__/soft-authenticator';

/*
 * The real better-auth HTTP pipeline with this instance's passkey plugins, on the memory
 * adapter. WebAuthn is simulated by a software authenticator (`__helpers__/soft-authenticator`)
 * that signs real ES256 assertions; `@simplewebauthn/server` verifies them unmodified. The API
 * lives on its own hostname and the web app on another, as on a two-hostname deploy, so the
 * relying party has to be the web app.
 */

const secret = 'passkey-integration-secret-at-least-thirty-two-chars';
const apiURL = 'https://api.money.example.test';
const appOrigin = 'https://money.example.test';
const password = 'correct horse battery staple';
const totpSecret = 'passkey-test-totp-secret';

type MemoryDB = Record<string, Row[]>;
type Row = Record<string, unknown>;

const totp = (): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', totpSecret).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};

/** A browser's cookie jar, enough for one origin. */
class Jar {
  private readonly cookies = new Map<string, string>();
  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  take(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      if (/max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(index + 1));
    }
  }
}

function fixture() {
  const db: MemoryDB = { account: [], passkey: [], session: [], twoFactor: [], user: [], verification: [] };
  const auth = betterAuth({
    // Better Auth turns these off under NODE_ENV=test; keep the production checks on.
    advanced: { disableCSRFCheck: false, disableOriginCheck: false },
    baseURL: apiURL,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      twoFactor({ twoFactorCookieMaxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS }),
      twoFactorOAuthGuard(),
      ...passkeyPlugins({ appName: 'WonderMoney', appUrl: `${appOrigin}/` }),
      bearer(),
    ],
    rateLimit: { enabled: false },
    secret,
    trustedOrigins: [appOrigin],
  });

  /** A request from the web app's page, carrying `jar`'s cookies and keeping what comes back. */
  const call = async (jar: Jar, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await auth.handler(new Request(`${apiURL}/api/auth${path}`, {
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: jar.header(),
        origin: appOrigin,
        ...headers,
      },
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    jar.take(response);
    return response;
  };

  const signUp = async (email: string): Promise<Jar> => {
    const jar = new Jar();
    const response = await call(jar, '/sign-up/email', { email, name: email, password });
    expect(response.status).toBe(200);
    return jar;
  };

  const signInWithPassword = async (email: string) => {
    const jar = new Jar();
    const response = await call(jar, '/sign-in/email', { email, password });
    return { body: await response.json() as Row, jar, response };
  };

  const sessionUser = async (jar: Jar): Promise<null | string> => {
    const body = await (await call(jar, '/get-session')).json() as null | { user: { email: string } };
    return body?.user.email ?? null;
  };

  const addPasskey = async (jar: Jar, name?: string) => {
    const authenticator = softAuthenticator({ origin: appOrigin });
    const options = await (await call(jar, '/passkey/generate-register-options')).json() as RegistrationOptions;
    const response = await call(jar, '/passkey/verify-registration', { name, response: authenticator.register(options) });
    expect(response.status).toBe(200);
    return { authenticator, passkey: await response.json() as Row & { id: string } };
  };

  /** A passkey sign-in from a browser with no session, as the login page does it. */
  const signInWithPasskey = async (
    authenticator: ReturnType<typeof softAuthenticator>,
    overrides?: { origin?: string; userVerified?: boolean },
  ) => {
    const jar = new Jar();
    const options = await (await call(jar, '/passkey/generate-authenticate-options')).json() as AuthenticationOptions;
    const response = await call(jar, '/passkey/verify-authentication', { response: authenticator.assert(options, overrides) });
    return { jar, options, response };
  };

  const enableTotp = async (email: string): Promise<void> => {
    const user = db['user']?.find((row) => row['email'] === email);
    if (!user) throw new Error(`No user ${email}`);
    user['twoFactorEnabled'] = true;
    db['twoFactor']?.push({
      backupCodes: await symmetricEncrypt({ data: JSON.stringify(['abcde-fghij']), key: secret }),
      id: `factor-${String(user['id'])}`,
      secret: await symmetricEncrypt({ data: totpSecret, key: secret }),
      userId: user['id'],
      verified: true,
    });
  };

  return { addPasskey, call, db, enableTotp, sessionUser, signInWithPasskey, signInWithPassword, signUp };
}

describe('passkey relying party', () => {
  it('is the web app: its hostname as the RP ID and its origin as the only origin', () => {
    expect(passkeyRelyingParty('https://money.example.com')).toEqual({ origin: 'https://money.example.com', rpID: 'money.example.com' });
    // One hostname for both (the proxy routes /v1 and /api/auth to the API): the same answer.
    expect(passkeyRelyingParty('https://money.example.com/')).toEqual({ origin: 'https://money.example.com', rpID: 'money.example.com' });
    expect(passkeyRelyingParty('http://localhost:3000')).toEqual({ origin: 'http://localhost:3000', rpID: 'localhost' });
    expect(passkeyRelyingParty('https://example.com:8443/money')).toEqual({ origin: 'https://example.com:8443', rpID: 'example.com' });
  });
});

describe('passkeys: real Better Auth pipeline with a software authenticator', () => {
  it('registers a passkey for the web app, lists it with its dates, and signs in with it', async () => {
    const f = fixture();
    const jar = await f.signUp('ana@example.test');

    const options = await (await f.call(jar, '/passkey/generate-register-options')).json() as RegistrationOptions;
    expect(options.rp.id).toBe('money.example.test');

    const { authenticator, passkey } = await f.addPasskey(jar, 'Laptop');
    expect(passkey).toMatchObject({ name: 'Laptop' });

    const listed = await (await f.call(jar, '/passkey/list-user-passkeys')).json() as Row[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ credentialID: authenticator.credentialId, name: 'Laptop' });
    expect(listed[0]?.['createdAt']).toBeTruthy();
    expect(listed[0]?.['lastUsedAt'] ?? null).toBeNull();

    const signIn = await f.signInWithPasskey(authenticator);
    expect(signIn.response.status).toBe(200);
    expect(await f.sessionUser(signIn.jar)).toBe('ana@example.test');

    const [afterSignIn] = await (await f.call(jar, '/passkey/list-user-passkeys')).json() as Row[];
    expect(new Date(String(afterSignIn?.['lastUsedAt'])).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('needs a signed-in session to add a passkey', async () => {
    const f = fixture();
    const response = await f.call(new Jar(), '/passkey/generate-register-options');
    expect(response.status).toBe(401);
  });

  it('refuses an assertion made on another origin, such as a phishing page', async () => {
    const f = fixture();
    const jar = await f.signUp('ana@example.test');
    const { authenticator } = await f.addPasskey(jar);

    const { jar: attacker, response } = await f.signInWithPasskey(authenticator, { origin: 'https://money-example.test' });
    expect(response.status).toBe(400);
    expect(await f.sessionUser(attacker)).toBeNull();
  });

  it('refuses an assertion without user verification', async () => {
    const f = fixture();
    const jar = await f.signUp('ana@example.test');
    const { authenticator } = await f.addPasskey(jar);

    const { jar: browser, response } = await f.signInWithPasskey(authenticator, { userVerified: false });
    expect(response.status).toBe(400);
    expect(await f.sessionUser(browser)).toBeNull();
  });

  it('keeps password sign-in working for a user with a passkey', async () => {
    const f = fixture();
    const jar = await f.signUp('ana@example.test');
    await f.addPasskey(jar);

    const { jar: browser, response } = await f.signInWithPassword('ana@example.test');
    expect(response.status).toBe(200);
    expect(await f.sessionUser(browser)).toBe('ana@example.test');
  });

  it('gives a two-factor user a full session from a passkey, while a password still needs the code', async () => {
    const f = fixture();
    const jar = await f.signUp('bea@example.test');
    const { authenticator } = await f.addPasskey(jar);
    await f.enableTotp('bea@example.test');

    const passkeySignIn = await f.signInWithPasskey(authenticator);
    expect(passkeySignIn.response.status).toBe(200);
    expect(await passkeySignIn.response.json()).not.toHaveProperty('twoFactorRedirect');
    expect(await f.sessionUser(passkeySignIn.jar)).toBe('bea@example.test');

    const passwordSignIn = await f.signInWithPassword('bea@example.test');
    expect(passwordSignIn.body).toMatchObject({ twoFactorRedirect: true });
    expect(await f.sessionUser(passwordSignIn.jar)).toBeNull();
    const verified = await f.call(passwordSignIn.jar, '/two-factor/verify-totp', { code: totp() });
    expect(verified.status).toBe(200);
    expect(await f.sessionUser(passwordSignIn.jar)).toBe('bea@example.test');
  });

  it('renames and deletes the user\'s own passkey, and a deleted passkey no longer signs in', async () => {
    const f = fixture();
    const jar = await f.signUp('ana@example.test');
    const { authenticator, passkey } = await f.addPasskey(jar, 'Laptop');

    const renamed = await f.call(jar, '/passkey/update-passkey', { id: passkey.id, name: 'Work laptop' });
    expect(renamed.status).toBe(200);
    expect(f.db['passkey']?.[0]).toMatchObject({ name: 'Work laptop' });

    const deleted = await f.call(jar, '/passkey/delete-passkey', { id: passkey.id });
    expect(deleted.status).toBe(200);
    expect(f.db['passkey']).toHaveLength(0);

    const { jar: browser, response } = await f.signInWithPasskey(authenticator);
    expect(response.status).toBe(401);
    expect(await f.sessionUser(browser)).toBeNull();
  });

  it('answers 404 to another user renaming or deleting a passkey, and leaves it alone', async () => {
    const f = fixture();
    const owner = await f.signUp('ana@example.test');
    const { passkey } = await f.addPasskey(owner, 'Laptop');
    const other = await f.signUp('bea@example.test');

    const rename = await f.call(other, '/passkey/update-passkey', { id: passkey.id, name: 'Mine now' });
    const remove = await f.call(other, '/passkey/delete-passkey', { id: passkey.id });
    const missing = await f.call(other, '/passkey/delete-passkey', { id: 'no-such-passkey' });

    expect([rename.status, remove.status, missing.status]).toEqual([404, 404, 404]);
    expect(f.db['passkey']).toEqual([expect.objectContaining({ id: passkey.id, name: 'Laptop' })]);
    expect(await (await f.call(other, '/passkey/list-user-passkeys')).json()).toEqual([]);
  });

  it('does not let a personal API token list or delete passkeys', async () => {
    const f = fixture();
    const owner = await f.signUp('ana@example.test');
    const { passkey } = await f.addPasskey(owner);
    const token = { authorization: 'Bearer wm_pat_0123456789abcdef0123456789abcdef', cookie: '' };

    const list = await f.call(new Jar(), '/passkey/list-user-passkeys', undefined, token);
    const remove = await f.call(new Jar(), '/passkey/delete-passkey', { id: passkey.id }, token);

    expect([list.status, remove.status]).toEqual([401, 401]);
    expect(f.db['passkey']).toHaveLength(1);
  });
});
