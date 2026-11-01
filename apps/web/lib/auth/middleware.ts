import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { routing } from "@/i18n/routing";

import { getSafeNextPath } from "./safe-next-path";
import {
  BETTER_AUTH_COOKIE_PREFIX,
  expireBetterAuthCookies,
  isSessionExpiredLogin,
} from "./stale-session";

/**
 * Optimistic, UX-only session gate. better-auth's session cookie is opaque
 * (not a JWT), so it cannot be verified from the Edge without asking the
 * better-auth server. This only checks that a session cookie is *present* —
 * no network call — to avoid flashing protected UI before the authoritative
 * check in `lib/auth/server-auth.ts` runs. Never treat this as authorization.
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse,
) {
  const url = request.nextUrl.clone();
  const segments = url.pathname.split("/").filter(Boolean);
  const hasLocalePrefix =
    segments.length > 0 && routing.locales.includes(segments[0]);
  const locale = hasLocalePrefix ? segments[0] : routing.defaultLocale;
  const pathAfterLocale = hasLocalePrefix
    ? `/${segments.slice(1).join("/")}`
    : url.pathname;

  // Abort early if we're on the oauth callback route
  if (pathAfterLocale.startsWith("/auth/callback")) {
    return response;
  }

  const hasSessionCookie = Boolean(
    getSessionCookie(request, { cookiePrefix: BETTER_AUTH_COOKIE_PREFIX }),
  );

  // The authoritative server check rejected this cookie and sent the browser
  // here. Expire it and show the login page; treating it as signed in
  // would bounce straight back into the app and loop.
  if (hasSessionCookie && isSessionExpiredLogin(url, pathAfterLocale)) {
    expireBetterAuthCookies(request, response);
    return response;
  }

  const isLoggedIn = hasSessionCookie;

  const isAuthRoute =
    pathAfterLocale === "/auth" || pathAfterLocale.startsWith("/auth/");
  // Household invite-accept (B5): reachable while logged out (to sign up) AND
  // while logged in (to show the "can't join with an existing account" screen),
  // so it's excluded from the logged-out gate but NOT bounced when logged in.
  const isJoinRoute =
    pathAfterLocale === "/join" || pathAfterLocale.startsWith("/join/");
  // The pivot-announcement banner (PivotBanner) links to /faq for logged-out
  // visitors too, so it must stay reachable without a session or the click
  // just redirect-loops into login.
  const isFaqRoute =
    pathAfterLocale === "/faq" || pathAfterLocale.startsWith("/faq/");

  // Preserve any cookies next-intl set on the routing response when we swap
  // in a redirect. No auth cookies are refreshed here — better-auth sessions
  // are managed by the API, so there is nothing to copy on that front.
  const copyResponseCookies = (target: NextResponse) => {
    response.cookies
      .getAll()
      .forEach(({ name, value, ...options }) =>
        target.cookies.set(name, value, options),
      );
  };

  // Redirect if user is logged in and trying to access the login/signup page
  if (
    isLoggedIn &&
    (pathAfterLocale.startsWith("/auth/login") ||
      pathAfterLocale.startsWith("/auth/signup"))
  ) {
    // Already signed in (e.g. a second tab): honour a safe `next` instead of
    // dropping the user on the home page.
    const next = getSafeNextPath(url.searchParams.get("next"), url.origin);
    const signedInResponse = NextResponse.redirect(
      new URL(next ?? `/${locale}`, url.origin),
    );
    copyResponseCookies(signedInResponse);
    return signedInResponse;
  }

  // Redirect if user is not logged in and trying to access a protected page
  if (
    !isLoggedIn &&
    !isAuthRoute &&
    !isJoinRoute &&
    !isFaqRoute
  ) {
    // Only `next` rides on the login URL: the page's own query string goes
    // inside it, so /en/accounts?tab=x comes back with its tab. Readers
    // validate it with getSafeNextPath before redirecting anywhere.
    const loginRedirectUrl = url.clone();
    loginRedirectUrl.pathname = `/${locale}/auth/login`;
    loginRedirectUrl.search = "";
    loginRedirectUrl.hash = "";
    const isLandingPage = pathAfterLocale === "/" || pathAfterLocale === "";
    if (!isLandingPage) {
      loginRedirectUrl.searchParams.set(
        "next",
        `/${locale}${pathAfterLocale}${url.search}`,
      );
    }
    const redirectResponse = NextResponse.redirect(loginRedirectUrl);
    copyResponseCookies(redirectResponse);
    return redirectResponse;
  }

  return response;
}
