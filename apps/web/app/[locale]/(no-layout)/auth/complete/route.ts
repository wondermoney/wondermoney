import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";

import { SIGNUP_COMPLETION_QUERY_PARAMS } from "@/lib/analytics/signup";
import api from "@/lib/api/api";
import { getServerApiUrl } from "@/lib/api/server-api-url";
import {
  buildLocalizedAuthErrorPath,
  buildSafeAuthOrigin,
  resolveAuthLocale,
} from "@/lib/auth/auth-error-redirect";
import { getSafeNextPath, withNextParam } from "@/lib/auth/safe-next-path";

type AuthCallbackResponse = {
  outcome?: "demo" | "login" | "signup";
  method?: string;
};

type BetterAuthSession = {
  session: Record<string, unknown>;
  user: Record<string, unknown>;
};

function shouldMarkAuthCompleteSignup(callbackResult?: AuthCallbackResponse) {
  return (
    callbackResult?.outcome === undefined || callbackResult.outcome === "signup"
  );
}

// Mirrors the authoritative session check in `lib/auth/server-auth.ts`'s
// `requireServerAuth`, but returns null on a missing/invalid session instead
// of redirecting — this route needs to distinguish "no session yet" (most
// likely a pending 2FA challenge) from "session confirmed" itself.
async function fetchBetterAuthSession(
  cookieHeader: string,
): Promise<BetterAuthSession | null> {
  const response = await fetch(`${getServerApiUrl()}/api/auth/get-session`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = (await response
    .json()
    .catch(() => null)) as BetterAuthSession | null;

  if (!data?.session || !data.user) return null;

  return data;
}

async function completeAuth(request: NextRequest) {
  const locale = resolveAuthLocale(
    request.nextUrl.pathname.split("/")[1] ?? "",
  );
  const safeOrigin = buildSafeAuthOrigin(request.nextUrl.origin);
  const fallbackErrorUrl = new URL(
    buildLocalizedAuthErrorPath(locale),
    request.url,
  );

  if (!safeOrigin) {
    Sentry.captureMessage(
      "Missing NEXT_PUBLIC_APP_URL for auth complete redirects",
      {
        level: "error",
        extra: {
          locale,
          pathname: request.nextUrl.pathname,
        },
      },
    );

    return {
      errorUrl: fallbackErrorUrl,
      ok: false as const,
      successUrl: new URL(`/${locale}/auth/mfa`, request.url),
    };
  }

  const errorUrl = new URL(buildLocalizedAuthErrorPath(locale), safeOrigin);
  // `next` comes from the Google callbackURL LoginForm built. Validate against
  // the configured origin, never the request's, and never log it.
  const next = getSafeNextPath(
    request.nextUrl.searchParams.get("next"),
    safeOrigin,
  );
  const mfaUrl = new URL(withNextParam(`/${locale}/auth/mfa`, next), safeOrigin);
  const successUrl = new URL(next ?? `/${locale}`, safeOrigin);
  // Markers on `next` itself would let a crafted link fake a signup event.
  for (const param of SIGNUP_COMPLETION_QUERY_PARAMS) {
    successUrl.searchParams.delete(param);
  }

  const cookieHeader = request.headers.get("cookie") ?? "";

  let session: BetterAuthSession | null;
  try {
    session = await fetchBetterAuthSession(cookieHeader);
  } catch (error) { // no-excuse-ok: catch -- HTTP boundary normalizes the session check
    Sentry.captureException(error);
    return { errorUrl, ok: false as const, successUrl };
  }

  if (!session) {
    // No full session yet — better-auth deletes the credential session and
    // issues a short-lived two-factor cookie instead when a 2FA challenge is
    // pending, so this is the expected state for a Google sign-in that still
    // needs a TOTP code. Route there; MfaForm's verify call fails cleanly if
    // there's no actual challenge pending.
    // STAGING-VERIFY: confirm this is the only way a Google OAuth completion
    // reaches here without a full session.
    return { errorUrl, ok: true as const, successUrl: mfaUrl };
  }

  try {
    const { data: callbackResult } = await api.post<AuthCallbackResponse>(
      "/v1/auth/callback",
      { locale },
      {
        baseURL: getServerApiUrl(),
        headers: { Cookie: cookieHeader },
      },
    );

    if (shouldMarkAuthCompleteSignup(callbackResult)) {
      successUrl.searchParams.set("signup_completed", "1");
      successUrl.searchParams.set(
        "signup_method",
        callbackResult.method ?? "oauth",
      );
      successUrl.searchParams.set("signup_source", "auth_complete");
    }

    return { errorUrl, ok: true as const, successUrl };
  } catch (error) { // no-excuse-ok: catch -- HTTP boundary normalizes callback failures
    Sentry.captureException(error);

    return { errorUrl, ok: false as const, successUrl };
  }
}

export async function GET(request: NextRequest) {
  const result = await completeAuth(request);

  return NextResponse.redirect(result.ok ? result.successUrl : result.errorUrl);
}
