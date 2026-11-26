"use client";

import { useLocale } from "next-intl";
import { useEffect, useEffectEvent } from "react";

import { authClient } from "@/lib/auth/client";

import {
  claimReopenAfterSignIn,
  isSessionFreshForSetup,
  markReopenAfterSignIn,
  type ReopenAfterSignIn,
} from "./enable-banking-setup-steps";

/**
 * Signing in again for a change to the Enable Banking key, which needs a session from the last
 * 24 hours: sign out, go to the login page, and come back to this page, where `reopen` opens
 * itself again (`useReopenAfterSignIn`).
 */
export function useSignInAgain(): (reopen: ReopenAfterSignIn) => Promise<void> {
  const locale = useLocale();
  return async (reopen) => {
    const next = `${window.location.pathname}${window.location.search}`;
    markReopenAfterSignIn(window.location.pathname, reopen);
    await authClient.signOut().catch(() => undefined);
    const login = new URL(`/${locale}/auth/login`, window.location.origin);
    login.searchParams.set("next", next);
    window.location.assign(login.toString());
  };
}

/** Back from signing in again for `target` on this page: open it, once. */
export function useReopenAfterSignIn(
  target: ReopenAfterSignIn,
  open: () => void,
): void {
  const reopen = useEffectEvent(open);
  useEffect(() => {
    if (claimReopenAfterSignIn(window.location.pathname, target)) reopen();
  }, [target]);
}

/**
 * What a change to the key needs from the signed-in session: whether it is recent enough, and
 * whether the authenticator code is asked for up front.
 */
export function useSensitiveSession(): {
  sessionFresh: boolean;
  twoFactorEnabled: boolean;
} {
  const { data: session } = authClient.useSession();
  return {
    sessionFresh: isSessionFreshForSetup(session?.session?.createdAt),
    twoFactorEnabled: Boolean(session?.user?.twoFactorEnabled),
  };
}
