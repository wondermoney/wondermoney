export const SENTRY_CLIENT_ENABLED =
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production" ||
  process.env.NEXT_PUBLIC_ENABLE_SENTRY === "1";

export const SENTRY_SERVER_ENABLED =
  SENTRY_CLIENT_ENABLED || process.env.ENABLE_SENTRY === "1";

export function isSentryEnabled() {
  return typeof window === "undefined"
    ? SENTRY_SERVER_ENABLED
    : SENTRY_CLIENT_ENABLED;
}
