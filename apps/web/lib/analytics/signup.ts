import { getAnalyticsConsent } from "./consent";
import { track } from "./track";

/**
 * The signup funnel's steps, under the names Google Tag Manager's tags read from the
 * `dataLayer`. PostHog receives only the steps the server can't see, as catalogue events:
 * `signup_started` and `signup_failed`. A signup that succeeds is the server's `signup`.
 */
export const SIGNUP_FUNNEL_EVENTS = {
  started: "signup_started",
  submitClicked: "signup_submit_clicked",
  submitFailed: "signup_submit_failed",
  submitSucceeded: "signup_submit_succeeded",
  completed: "signup_completed",
} as const;

/**
 * Query params the post-auth redirect adds on a real signup and
 * SignupCompletionTracker consumes. Stripped from any `?next=` destination
 * first, so a crafted link cannot fake a signup event.
 */
export const SIGNUP_COMPLETION_QUERY_PARAMS = [
  "signup_completed",
  "signup_method",
  "signup_source",
] as const;

export type SignupFunnelEventName =
  (typeof SIGNUP_FUNNEL_EVENTS)[keyof typeof SIGNUP_FUNNEL_EVENTS];

export type SignupFailureCategory =
  "app_callback" | "auth_provider" | "missing_user" | "recaptcha" | "unknown";

interface SignupFunnelProperties {
  failure_category?: SignupFailureCategory;
  locale?: string;
  method?: string;
  source?: string;
}

export function captureSignupFunnelEvent(
  eventName: SignupFunnelEventName,
  properties: SignupFunnelProperties = {},
) {
  if (!isSignupFunnelAnalyticsEnabled()) return;

  try {
    if (eventName === SIGNUP_FUNNEL_EVENTS.started) track("signup_started");
    if (eventName === SIGNUP_FUNNEL_EVENTS.submitFailed) {
      track("signup_failed", {
        reason: properties.failure_category ?? "unknown",
      });
    }

    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ ...withoutUndefined(properties), event: eventName });
  } catch {
    // no-excuse-ok: catch -- analytics must never block authentication
  }
}

function withoutUndefined(properties: SignupFunnelProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
}

function isSignupFunnelAnalyticsEnabled() {
  if (typeof window === "undefined") return false;
  if (getAnalyticsConsent() !== "granted") return false;
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "1"
  );
}

export function getSignupFailureCategory(
  error: unknown,
): SignupFailureCategory {
  if (
    error === "app_callback" ||
    error === "auth_provider" ||
    error === "missing_user" ||
    error === "recaptcha"
  ) {
    return error;
  }

  if (error && typeof error === "object") {
    const code = "code" in error ? error.code : undefined;
    const status = "status" in error ? error.status : undefined;

    if (typeof code === "string" || typeof status === "number") {
      return "auth_provider";
    }

    return "app_callback";
  }

  return "unknown";
}
