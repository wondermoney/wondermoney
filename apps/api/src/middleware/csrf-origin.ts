import type { NextFunction, Request, Response } from 'express';

import { defaultBrowserOrigins, resolveAppUrl } from '@config/instance-urls';
import { UnauthorizedError } from '@utils/errors';

const MUTATING_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);
const EXEMPT_PATH_PREFIXES = ['/v1/admin', '/v1/internal'];
// better-auth's session cookie is `better-auth.session_token`, optionally carrying a
// `__Secure-`/`__Host-` prefix (https) and `.0`/`.1` chunk suffixes when the value is
// large — so match on the stable core name to cover every variant.
const BETTER_AUTH_SESSION_COOKIE = 'better-auth.session_token';
// Any local port, not just the fixed list above — see isCsrfOriginAllowed().
const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/localhost:\d+$/;

export function csrfOriginProtection(req: Request, _res: Response, next: NextFunction) {
  if (!MUTATING_METHODS.has(req.method)) { next(); return; }
  if (isExemptPath(req.path)) { next(); return; }

  if (!hasCookieAuth(req)) { next(); return; }

  const requestOrigin = normalizeOrigin(getRequestOrigin(req));
  if (!requestOrigin || !isCsrfOriginAllowed(requestOrigin)) {
    next(new UnauthorizedError('Invalid request origin')); return;
  }

  next();
}

export function getCsrfAllowedOrigins(env: NodeJS.ProcessEnv = process.env) {
  const configuredValue = env['CSRF_ALLOWED_ORIGINS'];
  if (configuredValue?.trim()) return parseOrigins(configuredValue);

  const appEnv = normalizeAppEnv(env['APP_ENV'] || env['NODE_ENV']);
  return defaultBrowserOrigins(appEnv, resolveAppUrl(env, appEnv));
}

/**
 * Whether `origin` is allowed to make a cookie-authenticated mutation.
 *
 * Wraps getCsrfAllowedOrigins() with one additional carve-out: in local
 * development only (never staging or production), with no explicit
 * CSRF_ALLOWED_ORIGINS override configured, any `http://localhost:<port>`
 * origin is accepted. A dev/QA session running the web app on a
 * non-default port (e.g. because the default port is already taken) would
 * otherwise get a hard 401 on every signup/login callback.
 * The explicit env-var override, when set, remains authoritative and is
 * never widened.
 */
export function isCsrfOriginAllowed(origin: string, env: NodeJS.ProcessEnv = process.env) {
  if (getCsrfAllowedOrigins(env).includes(origin)) return true;

  if (env['CSRF_ALLOWED_ORIGINS']?.trim()) return false;

  const appEnv = normalizeAppEnv(env['APP_ENV'] || env['NODE_ENV']);
  return appEnv === 'development' && LOCALHOST_ORIGIN_PATTERN.test(origin);
}

function getRequestOrigin(req: Request) {
  return req.get('Origin') || req.get('Referer') || '';
}

function hasCookieAuth(req: Request) {
  const cookies = req.cookies as unknown;
  if (!cookies || typeof cookies !== 'object') return false;

  return Object.keys(cookies).some((cookieName) => cookieName.includes(BETTER_AUTH_SESSION_COOKIE));
}

function isExemptPath(path: string) {
  return EXEMPT_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
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
