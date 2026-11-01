import "server-only";

import * as Sentry from "@sentry/nextjs";
import Axios, { type AxiosInstance } from "axios";
import { cookies } from "next/headers";

import { redirectToLogin } from "@/lib/auth/login-redirect";
import { requireServerAuth } from "@/lib/auth/server-auth";

import { getApiErrorCode } from "./errors";
import { attachRateLimitInfo } from "./rate-limit";
import { getServerApiUrl } from "./server-api-url";

/**
 * The API's typed errors serialise their reason into the response body; read it
 * so an SSR 403 carries its reason instead of a bare status code that is easy to
 * misattribute to an auth race. Returns
 * undefined rather than guessing when the body isn't the expected shape.
 */
function extractApiErrorMessage(error: unknown): string | undefined {
  if (!Axios.isAxiosError(error)) return undefined;
  const data = error.response?.data as
    | { error?: unknown; message?: unknown }
    | undefined;
  if (!data || typeof data !== "object") return undefined;
  const message = data.message ?? data.error;
  return typeof message === "string" ? message : undefined;
}

/**
 * Creates a server-side Axios instance with authentication cookies forwarded.
 * Use this in Server Components to make authenticated API calls.
 *
 * Attempts to refresh the session once on a 401 before falling through to
 * a login redirect, matching the browser client's retry behaviour.
 *
 * @example
 * ```tsx
 * // In a Server Component
 * const api = await getServerApi(locale)
 * const data = await getBudgetsFull(api)
 * ```
 */
export async function getServerApi(locale: string): Promise<AxiosInstance> {
  const cookieStore = await cookies();
  // Gate on an authoritative session check; the api authenticates this
  // request via the forwarded cookie below, not a bearer token — better-auth
  // sessions are cookie-based, so there's no access token to attach here.
  await requireServerAuth(locale);
  const apiUrl = getServerApiUrl();

  const api = Axios.create({
    baseURL: apiUrl,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      cookie: cookieStore.toString(),
    },
    withCredentials: true,
  });

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      // Same normalisation as the browser client, so an SSR 429 reaches the
      // client with a window the calm state can count down from.
      attachRateLimitInfo(error);

      if (Axios.isAxiosError(error)) {
        const status = error.response?.status;

        // A plain 401 means the session expired or was revoked. better-auth
        // sessions are cookie-based with no client-driven refresh, so there is
        // nothing to retry with — redirect to login (the browser client's
        // getSession() revalidation covers the interactive path).
        if (status === 401) {
          await redirectToLogin(locale);
        }

        // A 403 is NOT an auth problem, and must not redirect to login. The
        // session is valid (`requireServerAuth` already confirmed it); the
        // request is forbidden for another reason, e.g. a household-owner-only
        // route. Redirecting to login turns a 403 into a lockout: middleware bounces a logged-in user off /auth/login back
        // to the page, which 403s and redirects again until the browser gives
        // up with ERR_TOO_MANY_REDIRECTS. Let it propagate instead.
        if (status === 403) {
          Sentry.captureException(error, {
            level: "warning",
            tags: {
              source: "ssr-api-auth",
              status: String(status),
              // A *tag*, not an extra: tags are indexed, so "which 403s are
              // these?" is a Sentry filter rather than reading prose.
              // `apiMessage` below stays an extra — useful once you have the
              // right event, useless for finding it.
              apiErrorCode: getApiErrorCode(error) ?? "none",
            },
            extra: {
              url: error.config?.url,
              method: error.config?.method,
              locale,
              // The reason, so a 403 can be diagnosed without guessing.
              apiMessage: extractApiErrorMessage(error),
            },
          });
        }
      }

      throw error;
    },
  );

  return api;
}
