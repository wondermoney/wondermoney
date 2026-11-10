"use client";

import { useCallback, useState } from "react";

import { authClient } from "@/lib/auth/client";
import { useUser } from "@/lib/auth/user-context";

export type ResendVerificationState = "idle" | "sending" | "sent" | "failed";

/**
 * Re-sends better-auth's verification link to the signed-in user. The API
 * points the link back at this app, so no callback URL is passed.
 */
export function useResendVerificationEmail() {
  const email = useUser()?.email ?? null;
  const [state, setState] = useState<ResendVerificationState>("idle");

  const resend = useCallback(async () => {
    if (!email) {
      setState("failed");
      return;
    }
    setState("sending");
    try {
      const { error } = await authClient.sendVerificationEmail({ email });
      setState(error ? "failed" : "sent");
    } catch {
      setState("failed");
    }
  }, [email]);

  return { email, resend, state };
}
