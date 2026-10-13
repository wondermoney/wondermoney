import { createHash, createHmac } from 'node:crypto';

import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuthMiddleware } from 'better-auth/api';
import { symmetricEncrypt } from 'better-auth/crypto';
import { bearer, jwt, twoFactor } from 'better-auth/plugins';
import type { AppleOptions } from 'better-auth/social-providers';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { configuredAppleOptions } from '../apple-options';
import { TWO_FACTOR_COOKIE_MAX_AGE_SECONDS, twoFactorOAuthGuard } from '../two-factor-oauth-guard';

const secret = 'integration-test-secret-at-least-thirty-two-characters';
const nonce = 'client-generated-native-nonce';
const baseURL = 'https://api.example.test';
const totpSecret = 'native-totp-test-secret';
const backupCode = 'abcde-fghij';
type MemoryDB = Record<string, Row[]> & { account: Row[]; jwks: Row[]; session: Row[]; twoFactor: Row[]; user: Row[]; verification: Row[]; };
type Row = Record<string, unknown>;
interface SuccessBody { token: string; url: string; user: { id: string }; }
const successBody = async (response: Response): Promise<SuccessBody> => await response.json() as SuccessBody;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  jwk = { ...await exportJWK(keys.publicKey), alg: 'RS256', kid: 'fixture-key', use: 'sig' };
});
afterEach(() => vi.restoreAllMocks());

const token = async (
  provider = 'google',
  claims: Row = {},
  signingKey = keys.privateKey,
  options: { audience?: string; expirationTime?: number | string; issuer?: string } = {},
): Promise<string> =>
  new SignJWT({
    email: 'native@example.test', email_verified: true, name: 'Native user',
    nonce, sub: 'social-subject', ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
    .setIssuer(options.issuer ?? (provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com'))
    .setAudience(options.audience ?? (provider === 'apple' ? 'money.wonder.native' : 'google-client'))
    .setIssuedAt().setExpirationTime(options.expirationTime ?? '5m').sign(signingKey);

const totp = (): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', totpSecret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};

const cookies = (response: Response): string => response.headers.getSetCookie()
  .filter((value) => !/max-age=0/i.test(value))
  .map((value) => value.split(';')[0]).join('; ');

function expectSanitized(response: Response, provisional: string | undefined): void {
  expect(response.headers.get('set-auth-token')).toBeNull();
  expect(response.headers.get('set-auth-jwt')).toBeNull();
  expect(response.headers.get('access-control-expose-headers') ?? '').not.toMatch(/set-auth-(token|jwt)/i);
  for (const value of response.headers.getSetCookie()) {
    if (/session_(?:token|data)(?:\.\d+)?=/.test(value)) expect(value).toMatch(/Max-Age=0/i);
    if (provisional) expect(value).not.toContain(provisional);
  }
}

async function fixture({
  appleOptions = configuredAppleOptions({ APPLE_CLIENT_ID: 'apple-web-client', APPLE_CLIENT_SECRET: 'apple-secret', APPLE_NATIVE_AUDIENCE: 'money.wonder.native' })!,
  cache = false,
  injectHeaders = false,
  mfa = true,
  oauth = false,
  verified = true,
}: {
  appleOptions?: AppleOptions;
  cache?: boolean;
  injectHeaders?: boolean;
  mfa?: boolean;
  oauth?: boolean;
  verified?: boolean;
} = {}) {
  const now = new Date();
  const db: MemoryDB = {
    account: ['google', 'apple'].map((providerId) => ({ accountId: 'social-subject', createdAt: now,
      id: `${providerId}-account`, providerId, updatedAt: now, userId: 'native-user' })),
    jwks: [],
    session: [], twoFactor: [{ backupCodes: await symmetricEncrypt({ data: JSON.stringify([backupCode]), key: secret }), id: 'factor', secret: await symmetricEncrypt({ data: totpSecret, key: secret }),
      userId: 'native-user',
      verified }], user: [{ createdAt: now, email: 'native@example.test', emailVerified: true,
      id: 'native-user', name: cache ? 'N'.repeat(12_000) : 'Native user', twoFactorEnabled: mfa, updatedAt: now }], verification: [],
  };
  let provisionalToken: string | undefined;
  let hadChunks = false;
  let oauthNonce: string | undefined;
  const auth = betterAuth({
    baseURL, database: memoryAdapter(db), secret, trustedOrigins: ['wondermoney://', 'https://app.example.test'],
    // Better Auth disables these by default under NODE_ENV=test; test production protections.
    advanced: { disableCSRFCheck: false, disableOriginCheck: false },
    hooks: { after: createAuthMiddleware(async (ctx) => {
      if (!ctx.context.newSession || !(ctx.path === '/sign-in/social' || ctx.path === '/callback/:id')) return;
      provisionalToken = ctx.context.newSession.session.token;
      hadChunks = !!ctx.context.responseHeaders?.get('set-cookie')?.includes('session_data.0=');
      if (injectHeaders) {
        for (const headers of [ctx.responseHeaders, ctx.context.responseHeaders]) {
          headers?.set('set-auth-token', provisionalToken);
          headers?.set('set-auth-jwt', 'provisional-jwt');
          headers?.set('access-control-expose-headers', 'X-Trace, Set-Auth-Token, set-auth-jwt');
        }
      }
    }) },
    plugins: [twoFactor({ twoFactorCookieMaxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS }), twoFactorOAuthGuard(), jwt(), bearer(), expo()],
    rateLimit: { enabled: false },
    session: { cookieCache: { enabled: cache, maxAge: 300 } },
    socialProviders: {
      apple: appleOptions,
      google: { clientId: 'google-client', clientSecret: 'google-secret' },
    },
  });
  const originalFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs' || url === 'https://appleid.apple.com/auth/keys') {
      return Response.json({ keys: [jwk] });
    }
    // Browser OAuth fixtures also replace the code exchange upstream (never core verification).
    if (oauth && url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'provider-access-token', expires_in: 300, id_token: await token('google', { nonce: oauthNonce }),
        token_type: 'Bearer' });
    }
    // No verifier/session mocks: only the provider's public-key transport is replaced.
    return originalFetch(input, init);
  });
  const request = (path: string, body?: Row, headers: Record<string, string> = {}) => auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  const native = async (provider = 'google', jwtToken?: string, idNonce = nonce) =>
    request('/sign-in/social', { idToken: { nonce: idNonce, token: jwtToken ?? await token(provider) }, provider });
  const callback = async (callbackURL: string) => {
    const initiation = await request('/sign-in/social', { callbackURL, provider: 'google' });
    const start = await successBody(initiation);
    const authorizeURL = new URL(start.url);
    oauthNonce = authorizeURL.searchParams.get('nonce') ?? undefined;
    expect(initiation.status).toBe(200);
    expect(db.session).toHaveLength(0);
    return request(`/callback/google?code=fixture-code&state=${encodeURIComponent(authorizeURL.searchParams.get('state')!)}`,
      undefined, { cookie: cookies(initiation) });
  };
  return { auth, callback, db, hadChunks: () => hadChunks, native, provisional: () => provisionalToken, request };
}

describe('native social MFA: real Better Auth HTTP pipeline', () => {
  it('pins the internal-hook ABI to the installed Better Auth and Expo 1.7.7 plugins', () => {
    // The guard reaches `internalAdapter.deleteSession`/`createVerificationValue`, the
    // `two_factor` pending cookie shape and `createAuthCookie`; asserting the plugin
    // versions proves which ABI the suite ran against without reading files off disk.
    expect(twoFactor().version).toBe('1.7.7');
    expect(jwt().version).toBe('1.7.7');
    expect(bearer().version).toBe('1.7.7');
    expect(expo().version).toBe('1.7.7');
  });

  it('validates explicit Apple configuration without accepting inferred or wildcard audiences', () => {
    expect(configuredAppleOptions({})).toBeUndefined();
    for (const audience of ['', ' ', '*.wonder.money', 'money.wonder native', 'money.wonder.native ']) {
      expect(() => configuredAppleOptions({ APPLE_NATIVE_AUDIENCE: audience })).toThrow();
    }
    expect(configuredAppleOptions({ APPLE_NATIVE_AUDIENCE: 'money.wonder.native' })).toEqual({
      audience: ['money.wonder.native'], clientId: 'money.wonder.native',
    });
  });

  it('preserves a sanitized OAuth redirect to an https callback target', async () => {
    const f = await fixture({ cache: true, injectHeaders: true, oauth: true });
    const response = await f.callback('https://app.example.test/auth/complete');
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.protocol).toBe('https:');
    expect(location.pathname).toBe('/auth/complete');
    expect(location.searchParams.get('cookie')).toBeNull();
    expectSanitized(response, f.provisional());
    expect(f.db.session).toHaveLength(0);
  });

  it('preserves a sanitized OAuth redirect to a wondermoney:// target and never embeds the provisional token in the Expo cookie payload', async () => {
    const f = await fixture({ cache: true, injectHeaders: true, oauth: true });
    const response = await f.callback('wondermoney://auth/complete');
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.protocol).toBe('wondermoney:');
    expect(location.host).toBe('auth');
    expect(location.pathname).toBe('/complete');
    expectSanitized(response, f.provisional());
    expect(f.db.session).toHaveLength(0);
    const payload = location.searchParams.get('cookie')!;
    expect(payload).toContain('two_factor=');
    expect(payload).not.toContain(f.provisional());
    const sessionEntries = payload.split(/, (?=[^;,]+=)/).filter((entry) => /session_(?:token|data)/.test(entry));
    expect(sessionEntries.length).toBeGreaterThan(0);
    for (const entry of sessionEntries) expect(entry).toMatch(/Max-Age=0/i);
  });

  it.each([false, true])('replaces success with pending-only JSON and revokes every session/cache cookie (cache=%s)', async (cache) => {
    const f = await fixture({ cache, injectHeaders: true });
    const response = await f.native();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ twoFactorMethods: ['totp'], twoFactorRedirect: true });
    expect(response.headers.get('location')).toBeNull();
    expectSanitized(response, f.provisional());
    expect(response.headers.get('access-control-expose-headers')).toBe('X-Trace');
    expect(f.db.session).toHaveLength(0);
    expect(f.hadChunks()).toBe(cache);
    expect(f.db.verification).toHaveLength(2);
    const pending = cookies(response);
    expect(pending).toContain('two_factor=');
    expect(await (await f.request('/get-session', undefined, { cookie: pending })).json()).toBeNull();
    expect(await (await f.request('/get-session', undefined, { authorization: `Bearer ${f.provisional()}` })).json()).toBeNull();
    expect((await f.request('/token', undefined, { cookie: pending })).status).toBe(401);
  });

  it.each(['totp', 'backup-code'])('allows only successful %s verification to issue a fresh session; pending replay denied', async (method) => {
    const f = await fixture();
    const pending = cookies(await f.native());
    const headers = { cookie: pending, 'expo-origin': 'wondermoney://auth/mfa' };
    const invalid = await f.request('/two-factor/verify-totp', { code: 'invalid' }, headers);
    expect(invalid.status).toBe(401);
    expect(f.db.session).toHaveLength(0);
    const path = `/two-factor/verify-${method}`;
    const body = { code: method === 'totp' ? totp() : backupCode };
    const verified = await f.request(path, body, headers);
    expect(verified.status).toBe(200);
    expect(f.db.session).toHaveLength(1);
    expect(f.db.session[0]!['token']).not.toBe(f.provisional());
    const authenticated = await f.request('/get-session', undefined, { cookie: cookies(verified) });
    expect((await successBody(authenticated)).user.id).toBe('native-user');
    const replay = await f.request(path, body, headers);
    expect(replay.status).not.toBe(200);
    expect(f.db.session).toHaveLength(1);
  });

  it('keeps native origin mapping subject to the trusted-origin check and never overrides a supplied Origin', async () => {
    const f = await fixture();
    const pending = cookies(await f.native());
    const contested: Record<string, string>[] = [
      { cookie: pending, 'expo-origin': 'evil://auth/mfa' },
      { cookie: pending, 'expo-origin': 'wondermoney://auth/mfa', origin: 'https://evil.example' },
    ];
    for (const headers of contested) {
      expect((await f.request('/two-factor/verify-totp', { code: totp() }, headers)).status).toBe(403);
    }
    expect(f.db.session).toHaveLength(0);
    expect((await f.request('/two-factor/verify-totp', { code: totp() }, { cookie: pending, 'expo-origin': 'wondermoney://any-host/any-path' })).status).toBe(200);
  });

  it('retains opaque bearer authentication for users without MFA', async () => {
    const f = await fixture({ mfa: false });
    const response = await f.native();
    const body = await successBody(response);
    expect(body.user.id).toBe('native-user');
    const bearerToken = response.headers.get('set-auth-token');
    expect(bearerToken).toBeTruthy();
    expect(body.token).toBe(f.db.session[0]!['token']);
    expect((await successBody(await f.request('/get-session', undefined, { authorization: `Bearer ${bearerToken}` }))).user.id).toBe('native-user');
  });

  it('does not advertise an unverified TOTP row', async () => {
    const f = await fixture({ verified: false });
    expect(await (await f.native()).json()).toEqual({ twoFactorMethods: [], twoFactorRedirect: true });
  });

  it.each(['deleteSession', 'createVerificationValue'] as const)('fails closed when %s fails', async (operation) => {
    const f = await fixture({ cache: true, injectHeaders: true });
    vi.spyOn((await f.auth.$context).internalAdapter, operation).mockRejectedValueOnce(new Error('injected adapter failure'));
    const response = await f.native();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'Unable to complete sign-in' });
    expectSanitized(response, f.provisional());
    expect(cookies(response)).not.toContain('two_factor=');
    expect(response.headers.get('location')).toBeNull();
    // A failing storage delete can leave an unreachable row, but no session handle may escape.
    expect(f.db.session).toHaveLength(operation === 'deleteSession' ? 1 : 0);
  });

  it.each(['google', 'apple'])('real %s verifier rejects bad signature, audience, expiry, nonce and absent/blank nonce', async (provider) => {
    const f = await fixture();
    const otherKey = await generateKeyPair('RS256');
    const validToken = await token(provider);
    for (const badNonce of ['', ' ', 'wrong']) {
      expect((await f.native(provider, validToken, badNonce)).status).not.toBe(200);
    }
    const absent = await f.request('/sign-in/social', { idToken: { token: validToken }, provider });
    expect(absent.status).toBe(400);
    for (const badToken of [
      await new SignJWT({ email: 'native@example.test', nonce, sub: 'social-subject' }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
        .setIssuer(provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com').setAudience('unknown-audience')
        .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey),
      await new SignJWT({ email: 'native@example.test', nonce, sub: 'social-subject' }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
        .setIssuer(provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com')
        .setAudience(provider === 'apple' ? 'money.wonder.native' : 'google-client').setIssuedAt().setExpirationTime(1).sign(keys.privateKey),
      await token(provider, {}, otherKey.privateKey),
    ]) expect((await f.native(provider, badToken)).status).toBe(401);
    expect(f.db.session).toHaveLength(0);
    expect((await f.native(provider, validToken)).status).toBe(200);
  });

  it('accepts both the Apple Services ID and the configured native bundle identifier as audiences', async () => {
    const f = await fixture();
    const servicesIdToken = await new SignJWT({ email: 'native@example.test', email_verified: true, nonce, sub: 'social-subject' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
      .setIssuer('https://appleid.apple.com').setAudience('apple-web-client')
      .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    expect((await f.native('apple', servicesIdToken)).status).toBe(200);
    expect((await f.native('apple', await token('apple'))).status).toBe(200);
    expect(f.db.session).toHaveLength(0);
  });

  it('verifies native-only Apple tokens without a web secret and preserves the MFA pending-only boundary', async () => {
    const appleOptions = configuredAppleOptions({ APPLE_NATIVE_AUDIENCE: 'money.wonder.app' })!;
    expect(appleOptions).toEqual({ audience: ['money.wonder.app'], clientId: 'money.wonder.app' });
    expect('clientSecret' in appleOptions).toBe(false);
    const f = await fixture({ appleOptions });
    const hashedNonce = createHash('sha256').update(nonce).digest('hex');

    for (const nonceClaim of [nonce, hashedNonce]) {
      const response = await f.native('apple', await token('apple', { nonce: nonceClaim }, keys.privateKey, { audience: 'money.wonder.app' }), nonce);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ twoFactorMethods: ['totp'], twoFactorRedirect: true });
      expect(response.headers.get('set-auth-token')).toBeNull();
      expectSanitized(response, f.provisional());
      expect(await (await f.request('/get-session', undefined, { cookie: cookies(response) })).json()).toBeNull();
      expect(await (await f.request('/get-session', undefined, { authorization: `Bearer ${f.provisional()}` })).json()).toBeNull();
      expect(f.db.session).toHaveLength(0);
    }

    expect(f.db.verification).toHaveLength(4);
  });

  it('rejects invalid native-only Apple claims and request nonces through the real verifier', async () => {
    const appleOptions = configuredAppleOptions({ APPLE_NATIVE_AUDIENCE: 'money.wonder.app' })!;
    const f = await fixture({ appleOptions });
    const otherKey = await generateKeyPair('RS256');
    const wrongAudience = await token('apple', {}, keys.privateKey, { audience: 'apple-web-client' });
    const unknownAudience = await token('apple', {}, keys.privateKey, { audience: 'other.wonder.app' });
    const wrongIssuer = await token('apple', {}, keys.privateKey, { audience: 'money.wonder.app', issuer: 'https://attacker.example' });
    const expired = await token('apple', {}, keys.privateKey, { audience: 'money.wonder.app', expirationTime: 1 });
    const missingTokenNonce = await token('apple', { nonce: undefined }, keys.privateKey, { audience: 'money.wonder.app' });
    const badSignature = await token('apple', {}, otherKey.privateKey, { audience: 'money.wonder.app' });

    for (const badToken of [wrongAudience, unknownAudience, wrongIssuer, expired, missingTokenNonce, badSignature]) {
      expect((await f.native('apple', badToken)).status).toBe(401);
    }
    for (const requestNonce of ['', ' ', 'mismatched-native-nonce']) {
      expect((await f.native('apple', await token('apple', {}, keys.privateKey, { audience: 'money.wonder.app' }), requestNonce)).status).not.toBe(200);
    }
    expect((await f.request('/sign-in/social', { idToken: { token: await token('apple', {}, keys.privateKey, { audience: 'money.wonder.app' }) }, provider: 'apple' })).status).toBe(400);
    expect(f.db.session).toHaveLength(0);
  });

  it('keeps browser Apple OAuth fail-closed without a client secret', async () => {
    const f = await fixture({ appleOptions: configuredAppleOptions({ APPLE_NATIVE_AUDIENCE: 'money.wonder.app' })! });
    const response = await f.request('/sign-in/social', { callbackURL: 'https://app.example.test/auth/complete', provider: 'apple' });
    expect(response.status).toBe(500);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-auth-token')).toBeNull();
    expect(f.db.session).toHaveLength(0);
  });

  it('Apple accepts exact-or-sha256 nonce; Google accepts only exact (not single-use prevention)', async () => {
    const f = await fixture();
    const hashedNonce = createHash('sha256').update(nonce).digest('hex');
    expect((await f.native('apple', await token('apple', { nonce: hashedNonce }))).status).toBe(200);
    expect((await f.native('google', await token('google', { nonce: hashedNonce }))).status).toBe(401);
  });
});
