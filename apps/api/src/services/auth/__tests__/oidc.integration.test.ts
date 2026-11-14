import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { symmetricEncrypt } from 'better-auth/crypto';
import { bearer, twoFactor } from 'better-auth/plugins';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAuthConfiguration } from '@config/configuration';

import { OIDC_PROVIDER_ID, oidcPlugins } from '../oidc';
import { signupPolicy } from '../signup-policy';
import { TWO_FACTOR_COOKIE_MAX_AGE_SECONDS, twoFactorOAuthGuard } from '../two-factor-oauth-guard';

import { type Claims, loopbackFetch, type MockOidcIssuer, startMockOidcIssuer } from './__helpers__/mock-oidc-issuer';

/*
 * Single sign-on through the real better-auth HTTP pipeline (memory adapter) against an OIDC
 * provider running in this process on 127.0.0.1 (`__helpers__/mock-oidc-issuer`): discovery,
 * the JWKS and the token endpoint are real HTTP, and the id_token is verified against the
 * provider's published key. The plugins are composed the way `better-auth.ts` composes them.
 */

const secret = 'oidc-integration-secret-at-least-thirty-two-characters';
const apiURL = 'https://api.money.example.test';
const appOrigin = 'https://money.example.test';
const callbackURL = `${appOrigin}/en/auth/complete`;
const errorCallbackURL = `${appOrigin}/en/auth/auth-code-error`;
const password = 'correct horse battery staple';

type MemoryDB = Record<string, Row[]> & { account: Row[]; session: Row[]; twoFactor: Row[]; user: Row[]; verification: Row[] };
type Row = Record<string, unknown>;

let issuer: MockOidcIssuer;

beforeAll(async () => {
  issuer = await startMockOidcIssuer();
});
afterAll(async () => {
  await issuer.close();
});
beforeEach(() => {
  vi.stubGlobal('fetch', loopbackFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  issuer.signWithRogueKey(false);
});

/** A browser's cookie jar, enough for one origin. */
class Jar {
  private readonly cookies = new Map<string, string>();
  has(name: string): boolean {
    return [...this.cookies.keys()].some((key) => key.endsWith(name));
  }
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

const person = (overrides: Claims = {}): Claims => ({
  email: 'ada@example.com',
  email_verified: true,
  groups: ['family'],
  name: 'Ada Lovelace',
  sub: 'idp-ada',
  ...overrides,
});

function fixture(env: Record<string, string> = {}, { signupMode = 'open' }: { signupMode?: string } = {}) {
  const loaded = loadAuthConfiguration({
    OIDC_CLIENT_ID: issuer.clientId,
    OIDC_CLIENT_SECRET: issuer.clientSecret,
    OIDC_DISPLAY_NAME: 'Home SSO',
    OIDC_ISSUER: issuer.issuer,
    ...env,
  }).oidc;
  if (!loaded) throw new Error('OIDC is not configured');
  const config = loaded;
  const db: MemoryDB = { account: [], session: [], twoFactor: [], user: [], verification: [] };
  /** What `onAdminClaim` wrote: the instance-admin flag per better-auth user id. */
  const admins = new Map<string, boolean>();
  const invites = new Set<string>();
  const auth = betterAuth({
    // Better Auth turns these off under NODE_ENV=test; keep the production checks on.
    advanced: { disableCSRFCheck: false, disableOriginCheck: false },
    baseURL: apiURL,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      signupPolicy({
        deps: { hasAnyUser: () => Promise.resolve(db.user.length > 0), hasPendingInvite: (email) => Promise.resolve(invites.has(email)) },
        env: { SIGNUP_MODE: signupMode },
        oidc: config,
      }),
      ...oidcPlugins(config, { onAdminClaim: (userId, admin) => { admins.set(userId, admin); return Promise.resolve(); } }),
      twoFactor({ twoFactorCookieMaxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS }),
      twoFactorOAuthGuard({ trustProviderMfa: config.trustIdpMfa ? [OIDC_PROVIDER_ID] : [] }),
      bearer(),
    ],
    rateLimit: { enabled: false },
    secret,
    trustedOrigins: [appOrigin],
  });

  const call = async (jar: Jar, path: string, body?: unknown) => {
    const response = await auth.handler(new Request(`${apiURL}/api/auth${path}`, {
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), cookie: jar.header(), origin: appOrigin },
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    jar.take(response);
    return response;
  };

  /** "Sign in with Home SSO" in a fresh browser, as `claims` at the provider. */
  const signIn = async (claims: Claims) => {
    const jar = new Jar();
    const start = await call(jar, '/sign-in/social', { callbackURL, errorCallbackURL, provider: OIDC_PROVIDER_ID });
    expect(start.status).toBe(200);
    const { url } = await start.json() as { url: string };
    const code = issuer.approve(url, claims);
    const state = new URL(url).searchParams.get('state') ?? '';
    const response = await call(jar, `/callback/${OIDC_PROVIDER_ID}?code=${code}&state=${encodeURIComponent(state)}`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    return { error: location.searchParams.get('error'), jar, landedOn: `${location.origin}${location.pathname}` };
  };

  const sessionUser = async (jar: Jar): Promise<null | Row> => {
    const body = await (await call(jar, '/get-session')).json() as null | { user: Row };
    return body?.user ?? null;
  };

  const signUpWithPassword = async (email: string) => {
    const response = await call(new Jar(), '/sign-up/email', { email, name: email, password });
    return { body: await response.json() as { user?: { id: string } }, status: response.status };
  };

  return { admins, auth, call, db, invites, sessionUser, signIn, signUpWithPassword };
}

/** The existing account's own address has been verified (the link from the sign-up email). */
const markVerified = (f: ReturnType<typeof fixture>) => Object.assign(f.db.user[0] ?? {}, { emailVerified: true });

describe('OIDC single sign-on', () => {
  it('signs a new person in end to end and keeps none of the provider tokens', async () => {
    const f = fixture();
    const { error, jar, landedOn } = await f.signIn(person());

    expect(error).toBeNull();
    expect(landedOn).toBe(callbackURL);
    expect(await f.sessionUser(jar)).toMatchObject({ email: 'ada@example.com', emailVerified: true, name: 'Ada Lovelace' });
    expect(f.db.account).toHaveLength(1);
    const [account] = f.db.account;
    expect(account).toMatchObject({ accountId: 'idp-ada', providerId: OIDC_PROVIDER_ID });
    // The id_token carries the whole group list; nothing from the provider is kept but the subject.
    expect(account?.['idToken'] ?? null).toBeNull();
    expect(account?.['accessToken'] ?? null).toBeNull();
    expect(account?.['refreshToken'] ?? null).toBeNull();
    // No admin groups configured: the admin flag is not managed.
    expect(f.admins.size).toBe(0);
  });

  it('refuses an id_token that is not signed with the provider\'s published key', async () => {
    const f = fixture();
    issuer.signWithRogueKey(true);
    const { error, jar, landedOn } = await f.signIn(person());

    expect(landedOn).toBe(errorCallbackURL);
    expect(error).toBeTruthy();
    expect(await f.sessionUser(jar)).toBeNull();
    expect(f.db.user).toHaveLength(0);
  });

  describe('allowed groups', () => {
    const env = { OIDC_ADMIN_GROUPS: 'wm-admins', OIDC_ALLOWED_GROUPS: 'family,friends' };

    it('refuses someone outside the allowed groups, with a reason the app can show', async () => {
      const f = fixture(env);
      const { error, jar, landedOn } = await f.signIn(person({ groups: ['neighbours'] }));

      expect(landedOn).toBe(errorCallbackURL);
      expect(error).toBe('OIDC_GROUP_NOT_ALLOWED');
      expect(await f.sessionUser(jar)).toBeNull();
      expect(f.db.user).toHaveLength(0);
    });

    it('refuses someone with no groups claim at all', async () => {
      const f = fixture(env);
      const { groups: _groups, ...claims } = person();
      expect((await f.signIn(claims)).error).toBe('OIDC_GROUP_NOT_ALLOWED');
    });

    it('admits members of an allowed group and members of an admin group', async () => {
      const f = fixture(env);
      expect((await f.signIn(person({ groups: ['friends'] }))).error).toBeNull();
      expect((await f.signIn(person({ email: 'grace@example.com', groups: ['wm-admins'], sub: 'idp-grace' }))).error).toBeNull();
      // A provider that sends one group as a plain string.
      expect((await f.signIn(person({ email: 'alan@example.com', groups: 'family', sub: 'idp-alan' }))).error).toBeNull();
      expect(f.db.user).toHaveLength(3);
    });

    it('refuses a returning user once they leave the allowed groups', async () => {
      const f = fixture(env);
      expect((await f.signIn(person())).error).toBeNull();
      const again = await f.signIn(person({ groups: [] }));

      expect(again.error).toBe('OIDC_GROUP_NOT_ALLOWED');
      expect(await f.sessionUser(again.jar)).toBeNull();
    });

    it('reads the groups from the claim OIDC_GROUPS_CLAIM names', async () => {
      const f = fixture({ ...env, OIDC_GROUPS_CLAIM: 'roles' });
      expect((await f.signIn(person({ groups: ['family'] }))).error).toBe('OIDC_GROUP_NOT_ALLOWED');
      expect((await f.signIn(person({ groups: [], roles: ['family'] }))).error).toBeNull();
    });
  });

  describe('admin groups', () => {
    it('grants admin on a sign-in from an admin group and revokes it on the next sign-in without it', async () => {
      const f = fixture({ OIDC_ADMIN_GROUPS: 'wm-admins, owners' });

      const first = await f.signIn(person({ groups: ['family', 'owners'] }));
      const userId = String((await f.sessionUser(first.jar))?.['id']);
      expect(f.admins.get(userId)).toBe(true);
      expect(f.db.user[0]?.['oidcAdmin']).toBe(true);

      const second = await f.signIn(person({ groups: ['family'] }));
      expect(await f.sessionUser(second.jar)).toMatchObject({ id: userId });
      expect(f.admins.get(userId)).toBe(false);
      expect(f.db.user[0]?.['oidcAdmin']).toBe(false);

      await f.signIn(person({ groups: ['wm-admins'] }));
      expect(f.admins.get(userId)).toBe(true);
    });

    it('does not let a person set the flag themselves', async () => {
      const f = fixture({ OIDC_ADMIN_GROUPS: 'wm-admins' });
      const { jar } = await f.signIn(person());
      await f.call(jar, '/update-user', { oidcAdmin: true });
      expect(f.db.user[0]?.['oidcAdmin']).toBe(false);
    });
  });

  describe('email verification', () => {
    it.each([false, 'false', undefined])('refuses an email the provider has not verified (email_verified=%s)', async (emailVerified) => {
      const f = fixture();
      const { error, jar } = await f.signIn(person({ email_verified: emailVerified }));

      expect(error).toBe('OIDC_EMAIL_NOT_VERIFIED');
      expect(await f.sessionUser(jar)).toBeNull();
      expect(f.db.user).toHaveLength(0);
    });

    it('accepts an unverified email only when OIDC_ALLOW_UNVERIFIED_EMAIL is set, as a new unverified account', async () => {
      const f = fixture({ OIDC_ALLOW_UNVERIFIED_EMAIL: 'true' });
      const { error, jar } = await f.signIn(person({ email_verified: false }));

      expect(error).toBeNull();
      expect(await f.sessionUser(jar)).toMatchObject({ emailVerified: false });
    });

    it('never links an unverified email to an existing account, even when unverified emails are allowed', async () => {
      const f = fixture({ OIDC_ALLOW_UNVERIFIED_EMAIL: 'true' });
      await f.signUpWithPassword('ada@example.com');
      markVerified(f);

      const { error, jar } = await f.signIn(person({ email_verified: false }));
      expect(error).toBe('account_not_linked');
      expect(await f.sessionUser(jar)).toBeNull();
      expect(f.db.account.filter((row) => row['providerId'] === OIDC_PROVIDER_ID)).toHaveLength(0);
    });
  });

  describe('linking to an existing account', () => {
    it('links a verified email to the existing account with that address', async () => {
      const f = fixture();
      const existing = await f.signUpWithPassword('ada@example.com');
      markVerified(f);

      const { error, jar } = await f.signIn(person({ email: 'Ada@Example.com' }));

      expect(error).toBeNull();
      expect(await f.sessionUser(jar)).toMatchObject({ id: existing.body.user?.id });
      expect(f.db.user).toHaveLength(1);
      expect(f.db.account.find((row) => row['providerId'] === OIDC_PROVIDER_ID)).toMatchObject({ userId: existing.body.user?.id });
    });

    it('does not link to an account whose own address was never verified', async () => {
      const f = fixture();
      await f.signUpWithPassword('ada@example.com');

      const { error, jar } = await f.signIn(person());
      expect(error).toBe('account_not_linked');
      expect(await f.sessionUser(jar)).toBeNull();
    });
  });

  describe('sign-up policy', () => {
    const seedFirstUser = (f: ReturnType<typeof fixture>) => {
      // In every mode the first account is allowed; seed one so the policy applies.
      f.db.user.push({ createdAt: new Date(), email: 'owner@example.com', emailVerified: true, id: 'owner', name: 'Owner', updatedAt: new Date() });
    };

    it.each(['closed', 'invite'])('refuses a new OIDC account when SIGNUP_MODE=%s and OIDC_AUTO_SIGNUP is off', async (signupMode) => {
      const f = fixture({}, { signupMode });
      seedFirstUser(f);
      const { error, jar } = await f.signIn(person());

      expect(error).toBe('SIGNUP_DISABLED');
      expect(await f.sessionUser(jar)).toBeNull();
      expect(f.db.user).toHaveLength(1);
    });

    it('admits an invited address in invite mode', async () => {
      const f = fixture({}, { signupMode: 'invite' });
      seedFirstUser(f);
      f.invites.add('ada@example.com');
      expect((await f.signIn(person())).error).toBeNull();
    });

    it('lets the first person in on an empty instance whatever the mode', async () => {
      const f = fixture({}, { signupMode: 'closed' });
      expect((await f.signIn(person())).error).toBeNull();
    });

    it('creates OIDC accounts with OIDC_AUTO_SIGNUP even when sign-up is closed, and only OIDC accounts', async () => {
      const f = fixture({ OIDC_AUTO_SIGNUP: 'true' }, { signupMode: 'closed' });
      seedFirstUser(f);

      expect((await f.signIn(person())).error).toBeNull();
      expect((await f.signUpWithPassword('mallory@example.com')).status).toBe(403);
      expect(f.db.user.map((user) => user['email'])).toEqual(['owner@example.com', 'ada@example.com']);
    });
  });

  describe('two-factor accounts', () => {
    const withTotp = async (f: ReturnType<typeof fixture>) => {
      const { jar } = await f.signIn(person());
      const userId = String((await f.sessionUser(jar))?.['id']);
      Object.assign(f.db.user[0] ?? {}, { twoFactorEnabled: true });
      f.db.twoFactor.push({ backupCodes: await symmetricEncrypt({ data: '[]', key: secret }), id: 'factor', secret: await symmetricEncrypt({ data: 'totp-secret', key: secret }), userId, verified: true });
      return userId;
    };

    it('asks for the local TOTP code after an OIDC sign-in by default', async () => {
      const f = fixture();
      await withTotp(f);
      const { error, jar, landedOn } = await f.signIn(person());

      expect(error).toBeNull();
      expect(landedOn).toBe(callbackURL);
      expect(await f.sessionUser(jar)).toBeNull();
      expect(jar.has('two_factor')).toBe(true);
    });

    it('trusts the provider\'s MFA with OIDC_TRUST_IDP_MFA and issues the session directly', async () => {
      const f = fixture({ OIDC_TRUST_IDP_MFA: 'true' });
      const userId = await withTotp(f);
      const { jar } = await f.signIn(person());

      expect(await f.sessionUser(jar)).toMatchObject({ id: userId });
      expect(jar.has('two_factor')).toBe(false);
    });
  });

  describe('OIDC_ONLY', () => {
    it.each([
      ['/sign-in/email', { email: 'ada@example.com', password }],
      ['/sign-up/email', { email: 'new@example.com', name: 'New', password }],
      ['/request-password-reset', { email: 'ada@example.com', redirectTo: `${appOrigin}/en/auth/reset` }],
      ['/reset-password', { newPassword: password, token: 'token' }],
    ])('refuses %s', async (path, body) => {
      const f = fixture({ OIDC_ONLY: 'true' });
      const response = await f.call(new Jar(), path, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'PASSWORD_SIGN_IN_DISABLED' });
    });

    it('keeps password sign-in when OIDC_ONLY is off', async () => {
      const f = fixture();
      await f.signUpWithPassword('ada@example.com');
      expect((await f.call(new Jar(), '/sign-in/email', { email: 'ada@example.com', password })).status).toBe(200);
    });
  });

  it('refuses a client-supplied id_token for the OIDC provider: sign-in goes through the provider', async () => {
    const f = fixture();
    const response = await f.call(new Jar(), '/sign-in/social', { idToken: { nonce: 'n', token: 'a.b.c' }, provider: OIDC_PROVIDER_ID });
    expect(response.status).toBe(400);
    expect(f.db.session).toHaveLength(0);
  });
});
