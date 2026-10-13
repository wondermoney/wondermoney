import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { routing } from "@/i18n/routing";

import { getBetterAuthCookiePrefix } from "./cookie-prefix";

const BETTER_AUTH_COOKIE_PREFIX = getBetterAuthCookiePrefix(
  process.env.NEXT_PUBLIC_API_URL,
);

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

  const isLoggedIn = Boolean(
    getSessionCookie(request, { cookiePrefix: BETTER_AUTH_COOKIE_PREFIX }),
  );

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

  const buildRedirect = (pathname: string) => {
    const redirectUrl = url.clone();
    redirectUrl.pathname = pathname;
    const redirectResponse = NextResponse.redirect(redirectUrl);
    copyResponseCookies(redirectResponse);
    return redirectResponse;
  };

  // Redirect if user is logged in and trying to access the login/signup page
  if (
    isLoggedIn &&
    (pathAfterLocale.startsWith("/auth/login") ||
      pathAfterLocale.startsWith("/auth/signup"))
  ) {
    return buildRedirect(`/${locale}`);
  }

  // Redirect if user is not logged in and trying to access a protected page
  if (
    !isLoggedIn &&
    !isAuthRoute &&
    !isJoinRoute &&
    !isFaqRoute
  ) {
    const loginRedirectUrl = url.clone();
    loginRedirectUrl.pathname = `/${locale}/auth/login`;
    loginRedirectUrl.searchParams.set("next", url.pathname);
    const redirectResponse = NextResponse.redirect(loginRedirectUrl);
    copyResponseCookies(redirectResponse);
    return redirectResponse;
  }

  return response;
}
