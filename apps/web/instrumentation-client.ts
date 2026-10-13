// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { SENTRY_CLIENT_ENABLED } from "@/lib/utils/sentry-enabled";

if (SENTRY_CLIENT_ENABLED) {
  void import("@/lib/utils/sentry-client")
    .then(({ initClientSentry }) => {
      initClientSentry();
    })
    .catch(() => {});
}

export async function onRouterTransitionStart(
  ...args: any[]
) {
  if (!SENTRY_CLIENT_ENABLED) return;
  const { captureRouterTransitionStart } = await import("@/lib/utils/sentry-client");
  return (captureRouterTransitionStart as (...args: any[]) => any)(...args);
}
