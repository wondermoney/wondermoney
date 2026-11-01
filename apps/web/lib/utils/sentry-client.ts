import * as Sentry from "@sentry/nextjs";

import { instanceConfig } from "@/lib/instance";
import { SENTRY_DATA_COLLECTION } from "@/lib/utils/sentry-data-collection";

const WKWEBVIEW_BRIDGE_NOISE =
  "undefined is not an object (evaluating 'window.webkit.messageHandlers')";

function isKnownWKWebViewBridgeNoise(event: Sentry.Event): boolean {
  const exception = event.exception?.values?.[0];

  return (
    exception?.type === "TypeError" &&
    (exception?.value === WKWEBVIEW_BRIDGE_NOISE ||
      event.message === WKWEBVIEW_BRIDGE_NOISE)
  );
}

export function captureClientException(
  ...args: Parameters<typeof Sentry.captureException>
) {
  return Sentry.captureException(...args);
}

export function captureClientMessage(
  ...args: Parameters<typeof Sentry.captureMessage>
) {
  return Sentry.captureMessage(...args);
}

export function captureRouterTransitionStart(
  ...args: Parameters<typeof Sentry.captureRouterTransitionStart>
) {
  return Sentry.captureRouterTransitionStart(...args);
}

export function initClientSentry() {
  Sentry.init({
    dsn: instanceConfig.sentryDsn ?? undefined,

    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: 0.8,
    debug: false,
    // Replays only around an error, never of whole sessions.
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    beforeSend(event) {
      // iOS WKWebView bridge noise from third-party/injected code; do not broaden.
      return isKnownWKWebViewBridgeNoise(event) ? null : event;
    },
    integrations: [
      Sentry.replayIntegration({
        // Screens show balances and transactions: text and inputs never leave the browser.
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    enabled: true,
  });
}
