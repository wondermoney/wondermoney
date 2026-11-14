"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";

import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";

/**
 * Signs out and then opens `destination` (the sign-in page, or sign-up from the demo).
 * The cache is dropped first so no query refetches against the closing session. A failed
 * sign-out is logged and the navigation still happens.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const router = useRouter();

  return async (destination: "/auth/login" | "/auth/signup") => {
    await queryClient.cancelQueries();
    queryClient.removeQueries();
    await authClient.signOut().catch((signOutError: unknown) => {
      console.error("Error logging out", signOutError);
    });
    posthog.reset();
    router.push(destination);
  };
}
