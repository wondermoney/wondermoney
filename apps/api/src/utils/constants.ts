import { template } from 'lodash-es';

import { APP_ENV, IS_PROD as ENV_IS_PROD, IS_DEV, IS_STAGING } from '@config/env';
import { defaultBrowserOrigins, resolveAppUrl, resolveInstanceUrls } from '@config/instance-urls';

type EmailNotSentTemplate = (payload: { normalizedEmail: string }) => string;

const emailNotSentTemplate = template(
  "Couldn't send email to ${normalizedEmail}. Please check if the email address is correct and try again.",
) as EmailNotSentTemplate;

export const ERROR = {
  AUTH: {
    ALREADY_ACTIVATED: 'Your account is already activated.',
    ALREADY_AUTHENTICATED: 'You are already authenticated.',
    EMAIL_EXISTS: 'Email address already registred.',
    EMAIL_MATCH: "Email addresses don't match",
    EMAIL_NOT_SENT: emailNotSentTemplate,
    EMPTY_PASSWORD: "User doesn't have a password.",
    INVALID_CREDENTIALS: 'Invalid credentials',
    INVALID_EMAIL: 'Invalid email address',
    INVALID_FACEBOOK: 'Something went wrong with the Facebook login',
    INVALID_FACEBOOK_EMAIL: "Your facebook account doesn't have a valid email address",
    INVALID_FACEBOOK_PERMISSIONS: 'You need to grant all requested permissions in order to authenticate',
    INVALID_GOOGLE: 'Something went wrong with the Google login',
    INVALID_GOOGLE_EMAIL: "Your google account doesn't have a valid email address",
    INVALID_GOOGLE_PERMISSIONS: 'You need to grant all requested permissions in order to authenticate',
    INVALID_ID: 'Invalid user id',
    INVALID_NOT_ACTIVATED: 'You need to activate your account. Check your email or request a new activation code here.',
    INVALID_OTP_CODE: 'Invalid OTP code.',
    INVALID_TOKEN: 'Invalid token.',
    INVALID_TWO_FACTOR_SECRET: 'Invalid two factor secret.',
    INVALID_USER: 'Invalid user.',
    NORMAL_ACC_LOGIN_FB:
      "There's an account associated with your Facebook email. Please login with email and password.",
    NORMAL_ACC_LOGIN_GOOGLE:
      "There's an account associated with your Google email. Please login with email and password.",
    PASSWORD_INVALID: 'Invalid password.',
    PASSWORD_LEN: 'Password must be 8-30 characters',
    PASSWORD_MATCH: "Passwords don't match.",
    RECAPTCHA: 'You need to complete the captcha.',
    REQUIRED: 'You need to login.',
  },
  COMMON: {
    NOT_FOUND: 'Not found.',
    OK: 'OK',
  },
  DB: {
    DUPLICATE_RECORD_CODE: '23505',
  },
  EMAIL_DUPLICATE: 'Email already registered.',
  EMAIL_NOTFOUND: 'Email not found.',
  EMAIL_SEND: 'Unable to send email. Please try again later.',
  SERVER: 'Something went wrong. Please try again later.',
  TOKEN_EXPIRED: 'Token has expired.',
};

export const IS_PROD = ENV_IS_PROD;
export { IS_DEV, IS_STAGING };
export function getAllowedOrigins(env: string | undefined = APP_ENV, explicitOrigins?: string) {
  if (explicitOrigins?.trim()) return parseOrigins(explicitOrigins);

  const appEnv = normalizeAppEnv(env);
  return defaultBrowserOrigins(appEnv, resolveAppUrl(process.env, appEnv));
}

export function getCorsAllowedOrigins(env: string | undefined = APP_ENV, explicitOrigins?: string) {
  if (explicitOrigins !== undefined) return getAllowedOrigins(env, explicitOrigins);
  return getAllowedOrigins(env, process.env['CORS_ALLOWED_ORIGINS']);
}

// Any local port, not just the fixed list above — see isCorsOriginAllowed().
const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/localhost:\d+$/;

/**
 * Whether `origin` is allowed to make a credentialed CORS request.
 *
 * Wraps getAllowedOrigins()/getCorsAllowedOrigins() with one additional
 * carve-out: in local development only (never staging or production), with
 * no explicit CORS_ALLOWED_ORIGINS override configured, any
 * `http://localhost:<port>` origin is accepted. A dev/QA session running
 * the web app on a non-default port would otherwise be silently locked out
 * of every authenticated request — see RAD-629. The explicit env-var
 * override, when set, remains authoritative and is never widened.
 */
export function isCorsOriginAllowed(origin: string, env: string | undefined = APP_ENV, explicitOrigins: string | undefined = process.env['CORS_ALLOWED_ORIGINS']) {
  if (getAllowedOrigins(env, explicitOrigins).includes(origin)) return true;

  if (explicitOrigins?.trim()) return false;

  return normalizeAppEnv(env) === 'development' && LOCALHOST_ORIGIN_PATTERN.test(origin);
}

function normalizeAppEnv(value: string | undefined) {
  const appEnv = value?.trim().toLowerCase();
  if (appEnv === 'production' || appEnv === 'staging') return appEnv;
  if (!appEnv || appEnv === 'development' || appEnv === 'test' || appEnv === 'local') return 'development';

  return 'production';
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function parseOrigins(value: string | undefined) {
  return value
    ?.split(',')
    .map((origin) => origin.trim())
    .map(normalizeOrigin)
    .filter(Boolean) ?? [];
}

export const CORS_ALLOWED_ORIGINS = getCorsAllowedOrigins();
export const ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS;

/**
 * Native app URL scheme(s) allowed as better-auth OAuth callback targets.
 *
 * `wondermoney://` is the Expo/React Native scheme registered in `mobile/app.config.ts`
 * (`scheme: 'wondermoney'`). A native OAuth flow hands control back to the app by
 * redirecting the *browser* to a `wondermoney://...` URL, so better-auth validates it as
 * a redirect/callback target via `trustedOrigins` — not as a browser `Origin` header.
 *
 * Keeping it in its own list (never in `ALLOWED_ORIGINS`/`CORS_ALLOWED_ORIGINS`) means
 * the credentialed CORS policy stays HTTP-origin-only: a custom scheme can't be sent as a
 * browser `Origin`, and adding it to the CORS list would only widen redirect validation.
 * Better Auth's Expo plugin treats the registered `wondermoney://` origin as a scheme-wide
 * native origin for Expo cookie requests; this grants all paths/hosts under that custom
 * scheme server-side. Keep it out of browser CORS; do not add wildcard browser origins.
 */
export const NATIVE_APP_SCHEME_ORIGINS = ['wondermoney://'] as const;

/**
 * Origins better-auth trusts for CSRF/redirect validation: browser HTTP origins plus the
 * native app scheme used as an OAuth callback target for mobile. Consumed by
 * `src/services/auth/better-auth.ts` (`trustedOrigins`).
 */
export const BETTER_AUTH_TRUSTED_ORIGINS = [...ALLOWED_ORIGINS, ...NATIVE_APP_SCHEME_ORIGINS];

const INSTANCE_URLS = resolveInstanceUrls(process.env, normalizeAppEnv(APP_ENV));
/** The web app's base URL (`APP_URL`). See `config/instance-urls.ts`. */
export const FRONTEND_URL = INSTANCE_URLS.appUrl;
/** The API's base URL (`API_URL`, else `BETTER_AUTH_URL`). */
export const BACKEND_URL = INSTANCE_URLS.apiUrl;

/**
 * The privacy-policy link in email footers: `PRIVACY_POLICY_URL` (a `{lang}` placeholder is
 * replaced with `en`/`pt`), or the app's own privacy settings.
 */
export function privacyPolicyUrl(lang: string): string {
  const configured = process.env['PRIVACY_POLICY_URL']?.trim();
  if (configured) return configured.replaceAll('{lang}', lang);
  return `${FRONTEND_URL}/${lang}/settings?tab=privacy`;
}

// Do not touch this! The CI/CD pipeline overwrites this string.
export const GITHUB_SHA = '##REPLACE_GITHUB_COMMIT_SHA_HERE##';

/**
 * Registered with Enable Banking as this application's `redirect_url` (see
 * `EnableBankingStartAuthorizationParams.redirectUrl`).
 * Production value confirmed already registered in Enable Banking's Control
 * Panel: https://api.wonder.money/v1/banking/enable-banking/callback.
 */
export const ENABLE_BANKING_CALLBACK_URL = `${BACKEND_URL}/v1/banking/enable-banking/callback`;

/**
 * Where the end user's browser lands after the Enable Banking callback handler runs.
 * Deliberately built only from the hardcoded/env-derived `FRONTEND_URL` plus a fixed
 * status literal — never from any part of the incoming callback request (`state`,
 * `code`, `error` are only ever used to look up our own DB row, never interpolated
 * into a redirect target) — so this can't become an open redirect.
 *
 * Lands on the existing Settings → "Bank Provider" tab (`?tab=bank-provider`,
 * `components/settings/BankProvider/EnableBankingKeySettings.tsx`), the natural place
 * a user who just went through the connect-a-bank flow should land back on.
 */
export const ENABLE_BANKING_CALLBACK_REDIRECT_URL = ({ status }: { status: 'error' | 'success' }) => {
  const url = new URL('/settings', FRONTEND_URL);
  url.searchParams.set('tab', 'bank-provider');
  url.searchParams.set('enableBankingConnection', status);
  return url.toString();
};

export const STORAGE_OCR_PREFIX = 'wmocr';
