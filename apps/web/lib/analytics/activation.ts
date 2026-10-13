import {
  ACTIVATION_EVENT_DEDUPE_POLICIES,
  type ActivationEventDedupePolicy,
  type ActivationEventName,
} from "./events";

type ActivationPropertyValue = string | number | boolean | null | undefined;

export type ActivationEventProperties = Record<string, ActivationPropertyValue>;

type SignupFailureCategory =
  | "app_callback"
  | "auth_provider"
  | "missing_user"
  | "recaptcha"
  | "unknown";

interface ActivationCaptureClient {
  capture: (eventName: string, properties?: Record<string, unknown>) => void;
}

interface ActivationDedupeContext {
  step?: string | null;
  userId?: string | null;
}

const SENSITIVE_ACTIVATION_PROPERTY_PATTERN =
  /(account_name|balance|email|error_detail|error_message|merchant|password|raw|token)/i;

const ACTIVATION_DEDUPE_STORAGE_PREFIX = "wondermoney:activation";

function getActivationDedupeStorage(
  policy: ActivationEventDedupePolicy,
): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    if (policy === "session") return window.sessionStorage;
    if (policy === "user") return window.localStorage;
  } catch {
    return null;
  }

  return null;
}

export function sanitizeActivationProperties(
  properties: ActivationEventProperties = {},
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        value !== undefined && !SENSITIVE_ACTIVATION_PROPERTY_PATTERN.test(key),
    ),
  ) as Record<string, string | number | boolean | null>;
}

export function captureActivationEvent(
  client: ActivationCaptureClient | null | undefined,
  eventName: ActivationEventName,
  properties?: ActivationEventProperties,
) {
  client?.capture(eventName, sanitizeActivationProperties(properties));
}

export function getActivationDedupeKey(
  eventName: ActivationEventName,
  context: ActivationDedupeContext = {},
): string | undefined {
  const policy = ACTIVATION_EVENT_DEDUPE_POLICIES[eventName];

  if (policy === "session") {
    const sessionKey = context.userId ? `user:${context.userId}` : "session";
    return `${ACTIVATION_DEDUPE_STORAGE_PREFIX}:${eventName}:session:${sessionKey}`;
  }

  if (policy === "user") {
    if (!context.userId) return undefined;
    return `${ACTIVATION_DEDUPE_STORAGE_PREFIX}:${eventName}:user:${context.userId}`;
  }

  if (policy === "step_view" && context.step) {
    return `${ACTIVATION_DEDUPE_STORAGE_PREFIX}:${eventName}:step_view:${context.step}`;
  }

  return undefined;
}

export function hasTrackedActivationEvent(
  eventName: ActivationEventName,
  context: ActivationDedupeContext = {},
): boolean {
  const policy = ACTIVATION_EVENT_DEDUPE_POLICIES[eventName];
  const storage = getActivationDedupeStorage(policy);
  const dedupeKey = getActivationDedupeKey(eventName, context);

  if (!storage || !dedupeKey) return false;

  try {
    return storage.getItem(dedupeKey) === "true";
  } catch {
    return false;
  }
}

export function markActivationEventTracked(
  eventName: ActivationEventName,
  context: ActivationDedupeContext = {},
) {
  const policy = ACTIVATION_EVENT_DEDUPE_POLICIES[eventName];
  const storage = getActivationDedupeStorage(policy);
  const dedupeKey = getActivationDedupeKey(eventName, context);

  if (!storage || !dedupeKey) return;

  try {
    storage.setItem(dedupeKey, "true");
  } catch {
    // Analytics dedupe storage must never interrupt the user flow.
  }
}
