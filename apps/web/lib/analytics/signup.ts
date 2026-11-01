import {
  type ActivationEventProperties,
  sanitizeActivationProperties,
} from "./activation";
import { ACTIVATION_EVENTS } from "./events";

export const SIGNUP_FUNNEL_EVENTS = {
  started: "signup_started",
  submitClicked: ACTIVATION_EVENTS.signupSubmitClicked,
  submitFailed: ACTIVATION_EVENTS.signupSubmitFailed,
  submitSucceeded: ACTIVATION_EVENTS.signupSubmitSucceeded,
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
  | "app_callback"
  | "auth_provider"
  | "missing_user"
  | "recaptcha"
  | "unknown";

interface SignupFunnelCaptureClient {
  capture: (eventName: string, properties?: Record<string, unknown>) => void;
}

export function captureSignupFunnelEvent(
  client: SignupFunnelCaptureClient | null | undefined,
  eventName: SignupFunnelEventName,
  properties?: ActivationEventProperties,
) {
  if (!isSignupFunnelAnalyticsEnabled()) return;

  try {
    const safeProperties = sanitizeActivationProperties(properties);

    client?.capture(eventName, safeProperties);

    if (typeof window === "undefined") return;

    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ ...safeProperties, event: eventName });
  } catch { // no-excuse-ok: catch -- analytics must never block authentication
  }
}

function isSignupFunnelAnalyticsEnabled() {
  if (typeof window === "undefined") return false;
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
