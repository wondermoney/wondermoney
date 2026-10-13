"use client";

import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useUser } from "@/lib/auth/user-context";
import {
  captureSignupFunnelEvent,
  SIGNUP_FUNNEL_EVENTS,
} from "@/lib/utils/analytics";

function getLocaleFromPathname(pathname: string) {
  const locale = pathname.split("/")[1];
  return locale || "en";
}

const ALLOWED_SOURCES = new Set([
  "auth_callback",
  "auth_complete",
  "signup_form",
]);
const ALLOWED_METHODS = new Set(["email", "google", "oauth"]);
const SIGNUP_COMPLETION_PENDING_KEY = "wondermoney:signup-completion:pending";

function normalizeSignupSource(source: string | null) {
  if (!source || !ALLOWED_SOURCES.has(source)) return null;
  return source;
}

function normalizeSignupMethod(method: string | null) {
  if (!method) return "unknown";
  return ALLOWED_METHODS.has(method) ? method : "unknown";
}

function readPendingSignupCompletion() {
  try {
    const value = window.sessionStorage.getItem(SIGNUP_COMPLETION_PENDING_KEY);
    return value
      ? (JSON.parse(value) as {
          method: string;
          locale: string;
          source: string;
        })
      : null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return null;
  }
}

function writePendingSignupCompletion(payload: {
  method: string;
  locale: string;
  source: string;
}) {
  try {
    window.sessionStorage.setItem(
      SIGNUP_COMPLETION_PENDING_KEY,
      JSON.stringify(payload),
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}

function removePendingSignupCompletion() {
  try {
    window.sessionStorage.removeItem(SIGNUP_COMPLETION_PENDING_KEY);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}

interface SignupCompletionTrackerProps {
  analyticsEnabled: boolean;
}

export function SignupCompletionTracker({
  analyticsEnabled,
}: SignupCompletionTrackerProps) {
  const posthog = usePostHog();
  const user = useUser();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const signupCompleted = url.searchParams.get("signup_completed");

    const cleanup = () => {
      url.searchParams.delete("signup_completed");
      url.searchParams.delete("signup_method");
      url.searchParams.delete("signup_source");
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    };

    if (!analyticsEnabled) {
      if (signupCompleted === "1") cleanup();
      removePendingSignupCompletion();
      return;
    }

    if (signupCompleted === "1") {
      const source = normalizeSignupSource(
        url.searchParams.get("signup_source"),
      );
      const method = normalizeSignupMethod(
        url.searchParams.get("signup_method"),
      );
      const locale = getLocaleFromPathname(pathname);

      if (!source) {
        cleanup();
        removePendingSignupCompletion();
        return;
      }

      writePendingSignupCompletion({ method, locale, source });
      cleanup();
    }

    if (!user?.id) return;

    const pending = readPendingSignupCompletion();
    if (!pending) {
      removePendingSignupCompletion();
      return;
    }

    const {
      locale: pendingLocale,
      method: pendingMethod,
      source: pendingSource,
    } = pending;
    const dedupeKey = `wondermoney:signup-completion:${user.id}:signup_completed:${pendingMethod}:signup_source:${pendingSource}`;

    try {
      if (window.sessionStorage.getItem(dedupeKey) === "true") {
        removePendingSignupCompletion();
        return;
      }
      window.sessionStorage.setItem(dedupeKey, "true");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }

    const properties = {
      locale: pendingLocale,
      method: pendingMethod,
      source: pendingSource,
    };

    captureSignupFunnelEvent(
      posthog,
      SIGNUP_FUNNEL_EVENTS.submitSucceeded,
      properties,
    );
    captureSignupFunnelEvent(
      posthog,
      SIGNUP_FUNNEL_EVENTS.completed,
      properties,
    );

    removePendingSignupCompletion();
  }, [analyticsEnabled, pathname, posthog, user?.id]);

  return null;
}
