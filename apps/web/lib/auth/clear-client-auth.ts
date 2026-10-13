import { getCookiesDomain } from "@/lib/utils/url";

import { getBetterAuthCookiePrefix } from "./cookie-prefix";

// Mirrors the better-auth cookie attributes (see lib/auth/client.ts's origin
// and the API's AUTH_COOKIE_DOMAIN, mirrored by NEXT_PUBLIC_AUTH_COOKIE_DOMAIN).
const cookieDomain = getCookiesDomain();
const cookieOptions = {
  domain: getCookiesDomain(),
  sameSite: "lax" as const,
  path: "/",
  secure: cookieDomain !== "localhost",
};

const BETTER_AUTH_COOKIE_PREFIX =
  getBetterAuthCookiePrefix(process.env.NEXT_PUBLIC_API_URL) ?? "better-auth";
const BETTER_AUTH_COOKIE_SUFFIXES = ["session_token", "session_data"];

function expireCookie(name: string) {
  const sameSite =
    typeof cookieOptions.sameSite === "string"
      ? `; SameSite=${cookieOptions.sameSite}`
      : "";
  const secure = cookieOptions.secure ? "; Secure" : "";
  const path = cookieOptions.path ?? "/";
  const expiredCookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${path}${sameSite}${secure}`;

  document.cookie = expiredCookie;
  if (cookieOptions.domain) {
    document.cookie = `${expiredCookie}; Domain=${cookieOptions.domain}`;
  }
}

/**
 * Best-effort client-side cleanup of better-auth cookies (and any stale
 * localStorage entries from a previous session).
 *
 * better-auth's primary session cookie is httpOnly, so JS cannot actually
 * delete it — this is defense-in-depth for any non-httpOnly better-auth
 * cookies. The real, authoritative sign-out is `authClient.signOut()`,
 * which invalidates the session server-side and clears the cookie via its
 * response.
 */
export function clearBetterAuthCookies() {
  if (typeof document === "undefined") return;

  try {
    const cookieNames = BETTER_AUTH_COOKIE_SUFFIXES.flatMap((suffix) => {
      const name = `${BETTER_AUTH_COOKIE_PREFIX}.${suffix}`;
      return [name, `__Secure-${name}`];
    });

    cookieNames.forEach(expireCookie);

    try {
      cookieNames.forEach((name) => {
        window.localStorage.removeItem(name);
      });
    } catch (storageError) {
      if (!(storageError instanceof Error)) throw storageError;
      console.error("Error clearing better-auth local storage", storageError);
    }
  } catch (cookieError) {
    if (!(cookieError instanceof Error)) throw cookieError;
    console.error("Error clearing better-auth cookies", cookieError);
  }
}
