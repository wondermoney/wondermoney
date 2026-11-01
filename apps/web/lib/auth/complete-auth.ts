"use client";

import { SIGNUP_COMPLETION_QUERY_PARAMS } from "@/lib/analytics/signup";
import api from "@/lib/api/api";
import { authClient } from "@/lib/auth/client";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";

export type AuthCallbackOutcome = "demo" | "login" | "signup";

export type AuthCallbackResponse = {
  readonly method?: string;
  readonly outcome?: AuthCallbackOutcome;
};

export type AuthCallbackBody = {
  /** Household invite token from `/join`; the API links the new user into the owner's tenant. */
  readonly inviteToken?: string;
  readonly locale?: string;
};

const DEFAULT_SIGNUP_METHOD = "email";

function shouldTrackSignupCompletion(
  outcome: AuthCallbackOutcome | undefined,
): boolean {
  return outcome === undefined || outcome === "signup";
}

function buildPostAuthRedirectUrl(
  locale: string,
  signupSource: string,
  callbackResult: AuthCallbackResponse | undefined,
  next: string | null,
): string {
  const url = new URL(
    getSafeNextPath(next, window.location.origin) ?? `/${locale}`,
    window.location.origin,
  );
  // Markers on `next` itself would let a crafted link fake a signup event.
  for (const param of SIGNUP_COMPLETION_QUERY_PARAMS) {
    url.searchParams.delete(param);
  }

  if (shouldTrackSignupCompletion(callbackResult?.outcome)) {
    url.searchParams.set("signup_completed", "1");
    url.searchParams.set(
      "signup_method",
      callbackResult?.method ?? DEFAULT_SIGNUP_METHOD,
    );
    url.searchParams.set("signup_source", signupSource);
  }

  return url.toString();
}

/**
 * Runs the post-session provisioning call (`POST /v1/auth/callback`,
 * authenticated via the better-auth session cookie — see the `withCredentials`
 * axios client in `lib/api/api.ts`) and navigates to the resulting
 * destination.
 *
 * Must only be called once a FULL better-auth session exists: after a
 * non-2FA email/social sign-in, an email sign-up, or a successful
 * `authClient.twoFactor.verifyTotp()`. Shared by LoginForm's non-2FA path,
 * SignupForm, and MfaForm's post-verify step to avoid duplicating the
 * provisioning + redirect logic.
 *
 * `next` is the `?next=` destination the user was originally headed to; it is
 * re-validated here and falls back to `/{locale}` when missing or unsafe.
 *
 * On failure, best-effort signs the now-orphaned session out and returns the
 * error so the caller can show a message instead of navigating away.
 */
export async function completeAuthAndRedirect(
  locale: string,
  body: AuthCallbackBody,
  signupSource: string,
  next: string | null = null,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    const { data } = await api.post<AuthCallbackResponse | undefined>(
      "/v1/auth/callback",
      body,
    );
    window.location.assign(
      buildPostAuthRedirectUrl(locale, signupSource, data, next),
    );
    return { ok: true };
  } catch (error) {
    // no-excuse-ok: catch -- best-effort rollback of an orphaned session;
    // the caller surfaces the failure to the user via a toast.
    await authClient.signOut();
    return { error, ok: false };
  }
}
