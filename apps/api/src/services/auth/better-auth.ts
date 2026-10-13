import { randomUUID } from 'crypto';
import type { IncomingHttpHeaders } from 'http';

import { expo } from '@better-auth/expo';
import bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { bearer, jwt, twoFactor } from 'better-auth/plugins';
import { Pool } from 'pg';

import { ConfigurationError, loadAuthConfiguration } from '@config/configuration';
import { IS_PROD, IS_PRODUCTION_LIKE } from '@config/env';
import { configuredAppleOptions } from '@service/auth/apple-options';
import { resolveAuthCookiePrefix } from '@service/auth/cookie-prefix';
import { isSignupAllowed, type SignupPolicyDeps } from '@service/auth/signup-policy';
import { TWO_FACTOR_COOKIE_MAX_AGE_SECONDS, twoFactorOAuthGuard } from '@service/auth/two-factor-oauth-guard';
import { sendEmailVerificationEmail, sendPasswordResetEmail } from '@service/email/email';
import { BACKEND_URL, BETTER_AUTH_TRUSTED_ORIGINS } from '@utils/constants';

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
export const BETTER_AUTH_SCHEMA = 'better_auth';

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

export const betterAuthPool = buildBetterAuthPool();

/** Drain better-auth's dedicated pg pool on graceful shutdown (see server.ts). */
export const closeBetterAuthPool = async (): Promise<void> => {
  await betterAuthPool.end();
};

const googleClientId = authConfig.googleClientId;
const googleClientSecret = authConfig.googleClientSecret;

// Apple Sign-in (mobile cutover). better-auth 1.7.7 (the version this lockfile
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
const cookieDomain = authConfig.cookieDomain;

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
  },
  appName: 'WonderMoney',
  basePath: '/api/auth',
  // Defaults to the API's own address (API_URL): better-auth lives inside the API.
  baseURL: authConfig.betterAuthUrl ?? BACKEND_URL,
  database: betterAuthPool,
  // Every way of creating an account (email/password, Google, Apple) goes through here, so this
  // is where SIGNUP_MODE is enforced (services/auth/signup-policy.ts).
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!(await isSignupAllowed(user.email, signupPolicyDeps))) {
            throw new APIError('FORBIDDEN', { code: 'SIGNUP_DISABLED', message: 'Sign-up is not open on this server.' });
          }
          return { data: user };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Legacy bcrypt hashes verify through the shim; new and reset passwords use
    // better-auth's own default hasher.
    password: { hash: hashPasswordShim, verify: verifyPasswordShim },
    // In-process (no cross-service call) branded WonderMoney reset email via Mailjet.
    sendResetPassword: async ({ url, user }) => {
      await sendPasswordResetEmail({ email: user.email, name: user.name }, url);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ url, user }) => {
      await sendEmailVerificationEmail({ email: user.email, name: user.name }, url);
    },
  },
  // twoFactor (TOTP + backup codes), jwt (JWKS at /api/auth/jwks for web's local
  // session verification), and bearer (Authorization: Bearer) support.
  // twoFactorOAuthGuard extends 2FA enforcement to Google/OAuth sign-in (better-auth
  // only gates credential sign-ins by default — see that module + the 2FA docs).
  plugins: [
    twoFactor({ issuer: 'WonderMoney', twoFactorCookieMaxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS }),
    twoFactorOAuthGuard(),
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
 * Portable-typed shape for the authenticated user, decoupled from better-auth's
 * internal (non-portable) inferred session type — see the module comment above.
 */
export interface AuthContext {
  session: AuthedSession;
  user: AuthedUser;
}

export interface AuthedSession {
  id: string;
}

export interface AuthedUser {
  email: string;
  emailVerified: boolean;
  id: string;
  image?: null | string;
  name?: null | string;
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
  return {
    session: { id: result.session.id },
    user: {
      email: result.user.email,
      emailVerified: result.user.emailVerified,
      id: result.user.id,
      image: result.user.image,
      name: result.user.name,
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

/** Admin delete: removes a better-auth user (account/session/twoFactor rows cascade via FKs). */
export const deleteBetterAuthUser = async (userId: string): Promise<void> => {
  await betterAuthPool.query(`delete from "${BETTER_AUTH_SCHEMA}"."user" where id = $1`, [userId]);
};

/** Remove any better-auth user with this email (idempotent seed/test helper). Cascades to account/session/twoFactor. */
export const deleteBetterAuthUserByEmail = async (email: string): Promise<void> => {
  await betterAuthPool.query(`delete from "${BETTER_AUTH_SCHEMA}"."user" where email = $1`, [email]);
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
