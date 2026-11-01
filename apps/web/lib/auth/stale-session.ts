import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest, NextResponse } from "next/server";

import { getCookiesDomain } from "@/lib/utils/url";

import { buildLocalizedLoginPath, resolveAuthLocale } from "./auth-error-redirect";
import { getBetterAuthCookiePrefix } from "./cookie-prefix";
import { getSafeNextPath, withNextParam } from "./safe-next-path";

/**
 * Recovery from a session cookie the API no longer accepts: the session
 * was revoked, the database was reset or restored, or `BETTER_AUTH_SECRET`
 * changed.
 *
 * The middleware only sees that a cookie is *present* and sends login/signup
 * into the app; the authoritative server check then rejects it and sends the
 * browser back to login. Server components cannot set cookies, so the server
 * check marks that login redirect with `reason=session-expired`, and the
 * middleware, which can, expires the better-auth cookies on that request and
 * lets the login page through. The next sign-in then starts clean.
 *
 * Edge-safe: imported by the middleware as well as server components.
 */

export const BETTER_AUTH_COOKIE_PREFIX =
  getBetterAuthCookiePrefix(process.env.NEXT_PUBLIC_API_URL) ?? "better-auth";

/** The page path (pathname + query) the middleware forwards to server components. */
export const REQUEST_PATH_HEADER = "x-wm-request-path";

const SESSION_EXPIRED_PARAM = "reason";
const SESSION_EXPIRED_VALUE = "session-expired";

// Next.js adds this to client-side navigation (RSC) requests; it is never part
// of the page's own URL.
const INTERNAL_SEARCH_PARAMS = ["_rsc"];

// Only the path is ever used, so the origin is a fixed placeholder that
// getSafeNextPath resolves `next` against to reject anything off-site.
const NEXT_PATH_ORIGIN = "http://localhost";

function hasSessionCookie(cookieHeader: string): boolean {
  return Boolean(
    getSessionCookie(new Headers({ cookie: cookieHeader }), {
      cookiePrefix: BETTER_AUTH_COOKIE_PREFIX,
    }),
  );
}

/** The value of {@link REQUEST_PATH_HEADER} for a request: its pathname and query. */
export function getRequestPath(url: URL): string {
  const search = new URLSearchParams(url.search);
  for (const param of INTERNAL_SEARCH_PARAMS) search.delete(param);
  const query = search.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

function isLandingPath(path: string, locale: string): boolean {
  return path === "/" || path === `/${locale}` || path === `/${locale}/`;
}

/**
 * Where the authoritative server check sends a browser with no valid session:
 * the localised login page, with the page it was on as a safe `next`, marked
 * as an expired session when the browser still sent a session cookie.
 */
export function buildServerLoginRedirect(
  locale: string,
  {
    cookieHeader,
    requestPath,
  }: { cookieHeader: string; requestPath: null | string },
): string {
  const next = getSafeNextPath(requestPath, NEXT_PATH_ORIGIN);
  const target = withNextParam(
    buildLocalizedLoginPath(locale),
    next && !isLandingPath(next, resolveAuthLocale(locale)) ? next : null,
  );

  if (!hasSessionCookie(cookieHeader)) return target;

  const url = new URL(target, NEXT_PATH_ORIGIN);
  url.searchParams.set(SESSION_EXPIRED_PARAM, SESSION_EXPIRED_VALUE);
  return `${url.pathname}${url.search}`;
}

export function isSessionExpiredLogin(url: URL, pathAfterLocale: string): boolean {
  return (
    pathAfterLocale.startsWith("/auth/login") &&
    url.searchParams.get(SESSION_EXPIRED_PARAM) === SESSION_EXPIRED_VALUE
  );
}

function isBetterAuthCookie(name: string): boolean {
  const unprefixed = name.replace(/^__(Secure|Host)-/u, "");
  return (
    unprefixed.startsWith(`${BETTER_AUTH_COOKIE_PREFIX}.`) ||
    unprefixed.startsWith(`${BETTER_AUTH_COOKIE_PREFIX}-`)
  );
}

/**
 * Expires every better-auth cookie the request carried (session token, cached
 * session data and its chunks, dont_remember) with the attributes the API set
 * them with: `Path=/`, `SameSite=Lax`, `Secure` on https, and both host-only
 * and the shared auth-cookie `Domain`, since a cookie is only replaced by one
 * with the same domain.
 */
export function expireBetterAuthCookies(
  request: NextRequest,
  response: NextResponse,
): void {
  const isHttps = request.nextUrl.protocol === "https:";
  const domain = getCookiesDomain();

  for (const { name } of request.cookies.getAll()) {
    if (!isBetterAuthCookie(name)) continue;

    const secure = isHttps || name.startsWith("__Secure-") || name.startsWith("__Host-");
    const expired = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

    response.headers.append("set-cookie", expired);
    if (domain && !name.startsWith("__Host-")) {
      response.headers.append("set-cookie", `${expired}; Domain=${domain}`);
    }
  }
}
