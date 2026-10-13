"use client";

import api from "@/lib/api/api";
import { authClient } from "@/lib/auth/client";

export type AuthCallbackOutcome = "demo" | "login" | "signup";

export type AuthCallbackResponse = {
  readonly method?: string;
  readonly outcome?: AuthCallbackOutcome;
};

export type AuthCallbackBody = {
  readonly locale?: string;
};

const DEFAULT_SIGNUP_METHOD = "email";

export function shouldTrackSignupCompletion(
  outcome: AuthCallbackOutcome | undefined,
): boolean {
  return outcome === undefined || outcome === "signup";
}

function buildPostAuthRedirectUrl(
  locale: string,
  signupSource: string,
  callbackResult: AuthCallbackResponse | undefined,
): string {
  const url = new URL(`/${locale}`, window.location.origin);

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
 * On failure, best-effort signs the now-orphaned session out and returns
 * `false` so the caller can show an error instead of navigating away.
 */
export async function completeAuthAndRedirect(
  locale: string,
  body: AuthCallbackBody,
  signupSource: string,
): Promise<boolean> {
  try {
    const { data } = await api.post<AuthCallbackResponse | undefined>(
      "/v1/auth/callback",
      body,
    );
    window.location.assign(
      buildPostAuthRedirectUrl(locale, signupSource, data),
    );
    return true;
  } catch {
    // no-excuse-ok: catch -- best-effort rollback of an orphaned session;
    // the caller surfaces the failure to the user via a toast.
    await authClient.signOut();
    return false;
  }
}
