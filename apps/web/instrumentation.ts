import { isSentryEnabled } from "@/lib/utils/sentry-enabled";

export async function onRequestError(
  ...args: any[]
) {
  if (!isSentryEnabled()) return;
  const Sentry = await import("@sentry/nextjs");
  return (Sentry.captureRequestError as (...args: any[]) => any).apply(
    Sentry,
    args,
  );
}

export async function register() {
  if (!isSentryEnabled()) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
