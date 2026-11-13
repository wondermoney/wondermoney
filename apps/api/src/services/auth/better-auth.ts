import { randomUUID } from 'crypto';
import type { IncomingHttpHeaders } from 'http';

import { expo } from '@better-auth/expo';
import bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { hashPassword, makeSignature, verifyPassword } from 'better-auth/crypto';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { bearer, jwt, twoFactor } from 'better-auth/plugins';
import { Pool } from 'pg';

import { DI } from '@app/database/di';
import { ConfigurationError, loadAuthConfiguration } from '@config/configuration';
import { IS_PROD, IS_PRODUCTION_LIKE } from '@config/env';
import { instanceName } from '@config/instance-name';
import { SupportedLanguages } from '@entity/Appuser';
import { BETTER_AUTH_IP_ADDRESS_OPTIONS } from '@middleware/client-ip';
import { configuredAppleOptions } from '@service/auth/apple-options';
import { type AccountLanguageLookup, authEmailLanguage, linkInAccountLocale } from '@service/auth/auth-email-language';
import { resolveAuthCookieDomain } from '@service/auth/cookie-domain';
import { resolveAuthCookiePrefix } from '@service/auth/cookie-prefix';
import { capDemoSessionRefresh, isExpiredDemoSession } from '@service/auth/demo-session';
import { aiRequiresVerifiedEmail, verificationLinkLandingOnApp } from '@service/auth/email-verification-policy';
import { syncInstanceAdmin } from '@service/auth/instance-admin.service';
import { OIDC_PROVIDER_ID, oidcPlugins } from '@service/auth/oidc';
import { passkeyPlugins } from '@service/auth/passkey';
import { signupPolicy, type SignupPolicyDeps } from '@service/auth/signup-policy';
import { TWO_FACTOR_COOKIE_MAX_AGE_SECONDS, twoFactorOAuthGuard } from '@service/auth/two-factor-oauth-guard';
import { sendEmailVerificationEmail, sendPasswordResetEmail } from '@service/email/email';
import { removePushDevicesForSession } from '@service/push/push-session-cleanup';
import { accountLocale } from '@utils/account-language';
import { BACKEND_URL, BETTER_AUTH_TRUSTED_ORIGINS, FRONTEND_URL } from '@utils/constants';
import logger from '@utils/logger';

// Validated better-auth / social sign-in env, resolved through the configuration module so
// every key is shape-checked once and read from a single place. `assertEnv('api')` in the
// entrypoint runs after static imports, so this loader validates exactly the auth block.
const authConfig = loadAuthConfiguration(process.env);

// Defense-in-depth: better-auth silently falls back to its own built-in default secret when
// `secret` is undefined, which would let a misconfigured staging/prod deploy start up "fine" and
// issue sessions no one can trust. Fail fast instead. Local dev/test may omit it.
if (IS_PRODUCTION_LIKE && !authConfig.betterAuthSecret) {
  throw new ConfigurationError('api', [{
    code: 'missing',
    message: 'BETTER_AUTH_SECRET is required in production/staging environments.',
    path: 'BETTER_AUTH_SECRET',
  }]);
}

/**
 * better-auth runs embedded inside `api`. All of its tables live in a dedicated
 * `better_auth` Postgres schema on the same database MikroORM uses — MikroORM
 * stays confined to `public`, so the two migration tools never collide. This
 * mirrors the existing pg-boss pattern (its own `pgboss` schema on the same DB).
 */
const BETTER_AUTH_SCHEMA = 'better_auth';

/**
 * Build a dedicated pg Pool for better-auth from the same `DB_*` env the app and
 * pg-boss use, pinning `search_path` to the `better_auth` schema so every query
 * (and better-auth's own CLI-generated schema) resolves there instead of `public`.
 */
const buildBetterAuthPool = (env: NodeJS.ProcessEnv = process.env): Pool => {
  const host = env['DB_HOST'];
  const port = env['DB_PORT'];
  const database = env['DB_DATABASE'];
  const username = env['DB_USERNAME'];
  const password = env['DB_PASSWORD'];

  if (!host || !port || !database || !username || !password) {
    throw new Error(
      'Invalid DB data in .env file for better-auth; expected DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD',
    );
  }

  const credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  const connectionString = `postgres://${credentials}${host}:${port}/${encodeURIComponent(database)}`;

  return new Pool({ connectionString, options: `-c search_path=${BETTER_AUTH_SCHEMA}` });
};

const betterAuthPool = buildBetterAuthPool();

/** Drain better-auth's dedicated pg pool on graceful shutdown (see server.ts). */
export const closeBetterAuthPool = async (): Promise<void> => {
  await betterAuthPool.end();
};

const googleClientId = authConfig.googleClientId;
const googleClientSecret = authConfig.googleClientSecret;

// Apple Sign-in (mobile cutover). better-auth 1.7.12 (the version this lockfile
// resolves) ships a built-in `apple` social provider in
// `@better-auth/core/dist/social-providers/apple.mjs`, re-exported from
// `better-auth/social-providers`; the provider id is literally "apple". It accepts
// `clientId` + `clientSecret` as strings. For Apple, `clientSecret` is the
// pre-generated "Sign in with Apple" client-secret JWT — better-auth does NOT mint
// it, so the operator must supply it (same shape as the docs' Apple example).
const appleOptions = configuredAppleOptions(authConfig);

// Set in staging/prod (e.g. `.wonder.money`) so the session cookie set by
// api.wonder.money is readable by app.wonder.money. Left unset locally, where a
// host-only cookie on localhost is correct — a `.wonder.money` domain would break it.
// Ignored when the API and the web app share a hostname (one-hostname self-hosting): the
// cookie is host-only there, so no domain needs configuring.
const cookieDomain = resolveAuthCookieDomain(authConfig.cookieDomain, { apiUrl: BACKEND_URL, appUrl: FRONTEND_URL });
if (authConfig.cookieDomain && !cookieDomain) {
  logger.warn(
    { cookieDomain: authConfig.cookieDomain },
    'AUTH_COOKIE_DOMAIN is ignored: the web app and the API share a hostname, so the session cookie is host-only',
  );
}

/**
 * Legacy-bcrypt password shim. Existing bcrypt hashes (`$2a$`/`$2b$`/`$2y$` prefixes)
 * are retained in `better_auth.account.password` instead of forcing those users through
 * a password reset. This detects that prefix.
 */
export const isLegacyBcryptHash = (hash: string): boolean => hash.startsWith('$2');

/**
 * `emailAndPassword.password.hash` override — delegates to better-auth's own default
 * (scrypt-based) hasher, so new users hash exactly like they would with no override at all.
 * Exported (and kept a thin wrapper) so the round-trip with `verifyPasswordShim` is unit-tested.
 */
export const hashPasswordShim = async (password: string): Promise<string> => hashPassword(password);

/**
 * `emailAndPassword.password.verify` override: legacy bcrypt hashes verify via
 * `bcrypt.compare`; everything else (new better-auth users) verifies via better-auth's own
 * default (scrypt-based) verifier, so this never re-implements password hashing. Note:
 * better-auth 1.6.23 does NOT re-hash on successful login, so this bcrypt branch stays live
 * for every migrated user until they reset their password — do not remove it on a schedule.
 */
export const verifyPasswordShim = async ({ hash, password }: { hash: string; password: string }): Promise<boolean> => {
  if (isLegacyBcryptHash(hash)) return bcrypt.compare(password, hash);
  return verifyPassword({ hash, password });
};

const cookiePrefix = resolveAuthCookiePrefix(process.env, { apiUrl: BACKEND_URL, isProduction: IS_PROD });

/** Signup-policy lookups, on the better-auth pool (its search_path is the better_auth schema). */
const signupPolicyDeps: SignupPolicyDeps = {
  hasAnyUser: async () => {
    const { rows } = await betterAuthPool.query<{ exists: boolean }>('select exists(select 1 from "user") as "exists"');
    return rows[0]?.exists ?? false;
  },
  hasPendingInvite: async (email) => {
    const { rows } = await betterAuthPool.query<{ exists: boolean }>(
      `select exists(
        select 1 from public.household_invite
        where lower(email_address) = $1 and status = 'pending' and expires_at > now() and deleted_at is null
      ) as "exists"`,
      [email],
    );
    return rows[0]?.exists ?? false;
  },
};

/**
 * The account language of a better-auth user: its own account first, then one with its address
 * (an account from before better-auth, which the auth callback reconnects). On the better-auth
 * pool, which better-auth's own hooks already run beside, outside any MikroORM request context.
 */
const accountLanguageOf: AccountLanguageLookup = async (user) => {
  const { rows } = await betterAuthPool.query<{ language: string }>(
    `select language from public.appuser
     where record_active and deleted_at is null and (external_user_id = $1 or lower(email_address) = lower($2))
     order by (external_user_id = $1) desc limit 1`,
    [user.id, user.email],
  );
  return rows[0]?.language ?? null;
};

// `auth` is kept module-internal on purpose: its fully-inferred type transitively
// names zod's `zod/v4` subpath, which isn't portable in the emitted .d.ts (TS2742).
// Consumers get portable-typed exports instead (`authHandler` here; a session-lookup
// helper is added in the middleware ticket). `web` builds its own typed client.
const auth = betterAuth({
  advanced: {
    ...(cookieDomain ? { crossSubDomainCookies: { domain: cookieDomain, enabled: true } } : {}),
    ...(cookiePrefix ? { cookiePrefix } : {}),
    // User ids are UUIDs for compatibility with existing user references.
    database: { generateId: () => randomUUID() },
    // SameSite=Lax is sufficient because app/api are same-site subdomains; `secure`
    // is derived from the https baseURL in staging/prod.
    defaultCookieAttributes: { sameSite: 'lax' },
    // The client address Express resolved from TRUST_PROXY, stamped by `configureClientIp`
    //. Without it the sign-in limiter falls back to one bucket shared by everyone.
    ipAddress: BETTER_AUTH_IP_ADDRESS_OPTIONS,
  },
  appName: instanceName(),
  basePath: '/api/auth',
  // Defaults to the API's own address (API_URL): better-auth lives inside the API.
  baseURL: authConfig.betterAuthUrl ?? BACKEND_URL,
  database: betterAuthPool,
  databaseHooks: {
    session: {
      // A session that ends (sign-out, revoke, password change, account deletion) takes its push
      // devices with it, so that phone gets no more notifications (services/push/push-device.service.ts).
      delete: {
        after: (session) => removePushDevicesForSession(session.id, (sql, params) => betterAuthPool.query(sql, params)),
      },
      update: {
        // A refresh never moves a demo session past its two hours (services/auth/demo-session.ts).
        before: (session, context) => Promise.resolve(capDemoSessionRefresh(session, context) as undefined | { data: typeof session & { expiresAt: Date } }),
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Legacy bcrypt hashes verify through the shim; new and reset passwords use
    // better-auth's own default hasher.
    password: { hash: hashPasswordShim, verify: verifyPasswordShim },
    // In-process, in the account's language, landing on the reset page in its locale. better-auth
    // calls this only for an address with an account and answers the same either way, so the
    // language lookup never throws (services/auth/auth-email-language.ts).
    sendResetPassword: async ({ url, user }) => {
      const language = await authEmailLanguage({ appUrl: FRONTEND_URL, link: url, user }, accountLanguageOf);
      const link = language ? linkInAccountLocale(url, FRONTEND_URL, language) : url;
      await sendPasswordResetEmail({ email: user.email, name: user.name }, link, language ?? SupportedLanguages.EN);
    },
  },
  emailVerification: {
    // A server that keeps AI to verified accounts mails the link at sign-up; otherwise nothing
    // asks for verification, so nothing is sent.
    sendOnSignUp: aiRequiresVerifiedEmail(),
    // In the account's language, or the sign-up page's before the account exists, as above.
    sendVerificationEmail: async ({ url, user }) => {
      const language = await authEmailLanguage({ appUrl: FRONTEND_URL, link: url, user }, accountLanguageOf);
      const landing = verificationLinkLandingOnApp(url, FRONTEND_URL, language && accountLocale(language));
      const link = language ? linkInAccountLocale(landing, FRONTEND_URL, language) : landing;
      await sendEmailVerificationEmail({ email: user.email, name: user.name }, link, language ?? SupportedLanguages.EN);
    },
  },
  // twoFactor (TOTP + backup codes), jwt (JWKS at /api/auth/jwks for web's local
  // session verification), and bearer (Authorization: Bearer) support.
  // twoFactorOAuthGuard extends 2FA enforcement to Google/OAuth sign-in (better-auth
  // only gates credential sign-ins by default — see that module + the 2FA docs).
  // Passkeys belong to the web app's hostname, and a passkey sign-in is a full session
  // even for a 2FA account (see services/auth/passkey.ts).
  // A failed OAuth or OIDC sign-in (refused group, unverified email, sign-up closed) lands on the
  // web app's sign-in error page, which explains the `error` code. Web passes the same page,
  // localized, as its `errorCallbackURL`; this default covers the mobile app's browser flow,
  // which shows the page in its sign-in sheet.
  onAPIError: { errorURL: new URL('auth/auth-code-error', FRONTEND_URL.endsWith('/') ? FRONTEND_URL : `${FRONTEND_URL}/`).toString() },
  // Plugin order matters for the after-hooks on the OAuth callback: the OIDC policy records the
  // admin claim before twoFactorOAuthGuard takes the new session away from a 2FA account.
  plugins: [
    // Every way of creating an account (email/password, Google, Apple, OIDC) goes through here,
    // so this is where SIGNUP_MODE is enforced (services/auth/signup-policy.ts).
    signupPolicy({ deps: signupPolicyDeps, oidc: authConfig.oidc }),
    ...(authConfig.oidc
      ? oidcPlugins(authConfig.oidc, {
        // Outside a request's MikroORM context: a fork of its own.
        onAdminClaim: async (userId, admin) => {
          if (!DI.orm) throw new Error('The database is not connected');
          await syncInstanceAdmin(DI.orm.em.fork(), userId, admin);
        },
      })
      : []),
    // The label authenticator apps show next to the code.
    twoFactor({ issuer: instanceName(), twoFactorCookieMaxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS }),
    // OIDC_TRUST_IDP_MFA: the provider's own MFA stands in for the local TOTP code.
    twoFactorOAuthGuard({ trustProviderMfa: authConfig.oidc?.trustIdpMfa ? [OIDC_PROVIDER_ID] : [] }),
    ...passkeyPlugins({ appName: instanceName(), appUrl: FRONTEND_URL }),
    jwt(),
    bearer(),
    expo(),
  ],
  secret: authConfig.betterAuthSecret ?? undefined,
  // The Google client is reused from the existing OAuth app. Referencing the
  // narrowed vars directly in the guard keeps them typed as `string` in-branch.
  // Apple is registered the same way: only when both its client id and (JWT)
  // client secret are present, so an unconfigured environment stays Google-only.
  socialProviders: {
    ...(googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {}),
    ...(appleOptions ? { apple: appleOptions } : {}),
  },
  // CORS/CSRF allowlist for credentialed cross-subdomain requests from web, plus the
  // native `wondermoney://` scheme as a server-side OAuth callback target for mobile.
  // The app scheme is deliberately NOT merged into CORS/`ALLOWED_ORIGINS` (see constants).
  trustedOrigins: BETTER_AUTH_TRUSTED_ORIGINS,
});

/** Express handler for all `/api/auth/*` routes (mounted in app.ts). */
export const authHandler = toNodeHandler(auth);

/**
 * Re-verify the signed-in user's TOTP code.
 *
 * better-auth's `/two-factor/verify-totp` endpoint accepts a full session as well as the
 * intermediate sign-in cookie: with a session it checks the submitted code against the
 * stored secret and rejects it with an `UNAUTHORIZED` APIError when wrong. That is exactly
 * the revalidation a sensitive action needs, so we reuse it instead of re-implementing TOTP.
 */
export const verifyTotpForSession = async (headers: IncomingHttpHeaders, code: string): Promise<void> => {
  await auth.api.verifyTOTP({ body: { code }, headers: fromNodeHeaders(headers) });
};

/**
 * Portable-typed shape for the authenticated user, decoupled from better-auth's
 * internal (non-portable) inferred session type — see the module comment above.
 */
export interface AuthContext {
  session: AuthedSession;
  user: AuthedUser;
}

export interface AuthedSession {
  /** better-auth session creation time; `requireSensitiveSession` uses it as the freshness clock. */
  createdAt: Date;
  id: string;
}

export interface AuthedUser {
  email: string;
  emailVerified: boolean;
  id: string;
  image?: null | string;
  name?: null | string;
  /** The instance-admin claim from the last OIDC sign-in; null when no admin groups set it. */
  oidcAdmin?: boolean | null;
  twoFactorEnabled?: boolean | null;
}

/**
 * Look up the current better-auth session from incoming request headers. This reads
 * both the session cookie and an `Authorization: Bearer` token (via the bearer
 * plugin), so callers don't need separate cookie/bearer branches. A non-null result
 * implies MFA is satisfied: for a 2FA-enabled user, a full session is only issued after
 * TOTP verification — credential sign-in returns an intermediate `twoFactorRedirect`
 * state, and OAuth sign-in is gated equivalently by `twoFactorOAuthGuard`. So there is
 * no separate `aal2` check to perform here.
 */
export const getAuthSession = async (headers: IncomingHttpHeaders): Promise<AuthContext | null> => {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!result) return null;
  // The demo account's sessions end two hours after they start, whatever better-auth's own expiry
  // says (services/auth/demo-session.ts). One past it is deleted, so its cookie stops everywhere.
  if (isExpiredDemoSession({ createdAt: result.session.createdAt, email: result.user.email })) {
    await deleteAuthSession(result.session.id);
    return null;
  }
  return {
    session: { createdAt: result.session.createdAt, id: result.session.id },
    user: {
      email: result.user.email,
      emailVerified: result.user.emailVerified,
      id: result.user.id,
      image: result.user.image,
      name: result.user.name,
      oidcAdmin: (result.user as { oidcAdmin?: boolean | null }).oidcAdmin ?? null,
      twoFactorEnabled: (result.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled ?? null,
    },
  };
};

/**
 * Map a user's earliest-created better-auth `account` row to the analytics "method"
 * label (`email` for password credentials, otherwise the OAuth provider id verbatim).
 */
export const getPrimaryAuthProvider = async (userId: string): Promise<string> => {
  const { rows } = await betterAuthPool.query<{ providerId: string }>(
    // Secondary sort on "providerId" keeps provider selection deterministic when
    // multiple accounts share the same creation timestamp.
    `select "providerId" from "${BETTER_AUTH_SCHEMA}"."account" where "userId" = $1 order by "createdAt" asc, "providerId" asc limit 1`,
    [userId],
  );
  const providerId = rows[0]?.providerId;
  return !providerId || providerId === 'credential' ? 'email' : providerId;
};

/** Admin delete: removes a better-auth user (account/session/twoFactor/passkey rows cascade via FKs). */
export const deleteBetterAuthUser = async (userId: string): Promise<void> => {
  await betterAuthPool.query(`delete from "${BETTER_AUTH_SCHEMA}"."user" where id = $1`, [userId]);
};

/** Remove any better-auth user with this email (idempotent seed/test helper). Cascades to account/session/twoFactor/passkey. */
export const deleteBetterAuthUserByEmail = async (email: string): Promise<void> => {
  await betterAuthPool.query(`delete from "${BETTER_AUTH_SCHEMA}"."user" where email = $1`, [email]);
};

/** Whether a better-auth user with this id exists (an account's login is still live). */
export const betterAuthUserExists = async (userId: string): Promise<boolean> => {
  const { rows } = await betterAuthPool.query<{ exists: boolean }>(
    `select exists(select 1 from "${BETTER_AUTH_SCHEMA}"."user" where id = $1) as "exists"`,
    [userId],
  );
  return rows[0]?.exists === true;
};

/**
 * A better-auth session created for a paired mobile device, with everything the app needs to
 * adopt it: the signed session-cookie value (the same value better-auth would have set on a
 * sign-in response) and the cookie's name for this deployment.
 *
 * The app cannot mint this itself — the value is signed with `BETTER_AUTH_SECRET` — so the
 * pairing exchange hands it over once, over HTTPS, instead of the app re-implementing the
 * cookie format.
 */
export interface PairedSession {
  /** The cookie's name, including any `__Secure-`/prefix decoration this deployment uses. */
  cookieName: string;
  /** URL-encoded signed cookie value (`token.signature`), ready to store as-is. */
  cookieValue: string;
  expiresAt: Date;
  sessionId: string;
  /** The raw session token. Never logged. */
  token: string;
}

/** The session fields the device list shows. */
export interface AuthSessionSummary {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  ipAddress?: null | string;
  updatedAt: Date;
  userAgent?: null | string;
}

/** How the session cookie is set on this deployment, for a route that hands out a session itself. */
export interface SessionCookieAttributes {
  domain?: string;
  httpOnly: boolean;
  path: string;
  sameSite?: 'lax' | 'none' | 'strict';
  secure: boolean;
}

/** A session created outside a sign-in endpoint, with its cookie attributes so a route can set it. */
export interface IssuedSession extends PairedSession {
  cookieAttributes: SessionCookieAttributes;
}

type BetterAuthContext = Awaited<typeof auth.$context>;

async function issueSession(
  context: BetterAuthContext,
  session: { expiresAt: Date; id: string; token: string },
): Promise<IssuedSession> {
  const cookie = context.authCookies.sessionToken;
  const signature = await makeSignature(session.token, context.secret);
  const sameSite = cookie.attributes.sameSite?.toLowerCase();
  return {
    cookieAttributes: {
      ...(cookie.attributes.domain ? { domain: cookie.attributes.domain } : {}),
      httpOnly: cookie.attributes.httpOnly ?? true,
      path: cookie.attributes.path ?? '/',
      ...(sameSite === 'lax' || sameSite === 'none' || sameSite === 'strict' ? { sameSite } : {}),
      secure: cookie.attributes.secure ?? false,
    },
    cookieName: cookie.name,
    cookieValue: encodeURIComponent(`${session.token}.${signature}`),
    expiresAt: session.expiresAt,
    sessionId: session.id,
    token: session.token,
  };
}

/**
 * Create a full better-auth session for `userId` without a password or a second factor.
 *
 * Only the QR pairing exchange calls this, and only after it has claimed a single-use pairing
 * code that a signed-in web session created — that session already satisfied MFA, which is why
 * a 2FA account needs no TOTP here. The session is stamped with the phone's user agent so the
 * device list has something to show.
 */
export const createPairedSession = async (input: {
  ipAddress?: null | string;
  userAgent?: null | string;
  userId: string;
}): Promise<PairedSession> => {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(input.userId, false, {
    ipAddress: input.ipAddress ?? '',
    userAgent: input.userAgent ?? '',
  });
  const { cookieAttributes: _cookieAttributes, ...paired } = await issueSession(context, session);
  return paired;
};

/**
 * Create a session for the shared demo account, ending at `expiresAt`.
 *
 * Only `POST /v1/auth/demo` calls this, after `signInToDemo` has checked that `userId` is the demo
 * account and that it has no TOTP. No IP address or user agent is stored: the demo's visitors are
 * strangers to each other. better-auth's create hooks run as for any session; the expiry is set
 * outright (`overrideAll`), since its default is the seven days an ordinary sign-in gets.
 */
export const createDemoSession = async (input: { expiresAt: Date; userId: string }): Promise<IssuedSession> => {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(
    input.userId,
    false,
    { expiresAt: input.expiresAt, ipAddress: '', userAgent: '' },
    true,
  );
  return issueSession(context, session);
};

/** One better-auth user's identity and TOTP state, or null when there is none with this id. */
export const findBetterAuthUser = async (
  userId: string,
): Promise<null | { email: string; id: string; twoFactorEnabled: boolean | null }> => {
  const { rows } = await betterAuthPool.query<{ email: string; id: string; twoFactorEnabled: boolean | null }>(
    `select id, email, "twoFactorEnabled" from "${BETTER_AUTH_SCHEMA}"."user" where id = $1`,
    [userId],
  );
  return rows[0] ?? null;
};

/** Delete a user's sessions that are already past their expiry. Live sessions are untouched. */
export const deleteExpiredAuthSessions = async (userId: string): Promise<void> => {
  await betterAuthPool.query(`delete from "${BETTER_AUTH_SCHEMA}"."session" where "userId" = $1 and "expiresAt" <= now()`, [userId]);
};

/**
 * Create the demo account's better-auth user if there is none, then put it back in its demo state:
 * its name, a verified address, no TOTP, no passkeys and no linked social logins. Touches that one
 * user's rows only. A user created here has no password: the one-click sign-in needs none.
 *
 * Written against the pool rather than `signUpEmail` on purpose: a demo server usually runs with
 * sign-up closed, and the sign-up policy hook would refuse the seeder too.
 */
export const ensureDemoAuthUser = async (input: { email: string; name: string }): Promise<{ created: boolean; id: string }> => {
  const client = await betterAuthPool.connect();
  try {
    await client.query('begin');
    const existing = await client.query<{ id: string }>(`select id from "${BETTER_AUTH_SCHEMA}"."user" where lower(email) = lower($1) for update`, [input.email]);
    const found = existing.rows[0]?.id;
    const id = found ?? randomUUID();
    if (found) {
      await client.query(
        `update "${BETTER_AUTH_SCHEMA}"."user" set name = $2, "emailVerified" = true, "twoFactorEnabled" = false, "updatedAt" = now() where id = $1`,
        [id, input.name],
      );
    } else {
      await client.query(
        `insert into "${BETTER_AUTH_SCHEMA}"."user" (id, name, email, "emailVerified", "twoFactorEnabled", "createdAt", "updatedAt") values ($1, $2, $3, true, false, now(), now())`,
        [id, input.name, input.email],
      );
    }
    await client.query(`delete from "${BETTER_AUTH_SCHEMA}"."twoFactor" where "userId" = $1`, [id]);
    await client.query(`delete from "${BETTER_AUTH_SCHEMA}"."passkey" where "userId" = $1`, [id]);
    await client.query(`delete from "${BETTER_AUTH_SCHEMA}"."account" where "userId" = $1 and "providerId" <> 'credential'`, [id]);
    await client.query('commit');
    return { created: !found, id };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

/** Session rows for the device list, newest first. Unknown ids are simply absent. */
export const listAuthSessions = async (sessionIds: string[]): Promise<AuthSessionSummary[]> => {
  if (sessionIds.length === 0) return [];
  const { rows } = await betterAuthPool.query<{
    createdAt: Date;
    expiresAt: Date;
    id: string;
    ipAddress: null | string;
    updatedAt: Date;
    userAgent: null | string;
  }>(
    `select id, "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent"
       from "${BETTER_AUTH_SCHEMA}"."session"
      where id = any($1::text[])
      order by "createdAt" desc`,
    [sessionIds],
  );
  return rows;
};

/** Delete one better-auth session by id. The next request with its cookie gets 401. */
export const deleteAuthSession = async (sessionId: string): Promise<void> => {
  await betterAuthPool.query(`delete from "${BETTER_AUTH_SCHEMA}"."session" where id = $1`, [sessionId]);
};

/**
 * Email better-auth's verification link to `email`. Following it marks the address verified and
 * lands on the web login page, where signing in again reconnects the account from before
 * better-auth (see legacy-account-reconnect.service.ts).
 */
export const sendReconnectVerificationEmail = async (email: string, locale: string): Promise<void> => {
  await auth.api.sendVerificationEmail({ body: { callbackURL: `${FRONTEND_URL}/${locale}/auth/login`, email } });
};

/** Create a better-auth email/password user in-process (correct password hashing, credential account).
 *  Returns the generated user id. Used by test/seed helpers. */
export const createBetterAuthUser = async (
  input: { email: string; name?: string; password: string; },
): Promise<{ id: string }> => {
  const result = await auth.api.signUpEmail({
    body: { email: input.email, name: input.name ?? input.email, password: input.password },
  });
  return { id: result.user.id };
};
