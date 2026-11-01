import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { buildServerLoginRedirect, REQUEST_PATH_HEADER } from "./stale-session";

/**
 * Ends a server render that found no valid session: redirects to login with
 * the current page as `next`. When the browser still sent a session cookie,
 * the redirect is marked so the middleware clears that cookie instead of
 * bouncing the login page back into the app (#138).
 */
export async function redirectToLogin(locale: string): Promise<never> {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);

  redirect(
    buildServerLoginRedirect(locale, {
      cookieHeader: cookieStore.toString(),
      requestPath: requestHeaders.get(REQUEST_PATH_HEADER),
    }),
  );
}
