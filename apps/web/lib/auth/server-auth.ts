import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { buildLocalizedLoginPath } from "./auth-error-redirect";

// Not read via lib/utils/env.ts here to avoid pulling lib/api/api.ts (and its
// authClient import) into this server-only module; mirrors the same
// fallback used by getApiUrl() in lib/api/api.ts.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type BetterAuthServerSession = {
  session: Record<string, unknown>;
  user: Record<string, unknown>;
};

/**
 * The one authoritative server-side session check. better-auth's session
 * cookie is opaque (not a JWT), so unlike Supabase's local getClaims() there
 * is no way to verify it without asking the better-auth server. This makes
 * exactly one request to `/api/auth/get-session`, forwarding the incoming
 * cookies, and returns `null` when there is no valid session.
 *
 * Returns instead of redirecting so callers that only need to know whether a
 * session exists (e.g. the `/join` gate) can ask without being bounced.
 */
export const getServerSession = cache(
  async (): Promise<BetterAuthServerSession | null> => {
    const cookieStore = await cookies();

    const response = await fetch(`${API_URL}/api/auth/get-session`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response
      .json()
      .catch(() => null)) as BetterAuthServerSession | null;

    if (!data?.session || !data.user) {
      return null;
    }

    return data;
  },
);

/**
 * Requires a session, redirecting to login when there is none. Use this to
 * gate route groups and SSR data fetching.
 */
export const requireServerAuth = cache(async (locale: string) => {
  const data = await getServerSession();

  if (!data) {
    redirect(buildLocalizedLoginPath(locale));
  }

  return data;
});
