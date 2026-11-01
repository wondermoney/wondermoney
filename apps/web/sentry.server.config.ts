// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { instanceConfig } from "@/lib/instance";
import { SENTRY_DATA_COLLECTION } from "@/lib/utils/sentry-data-collection";
import { SENTRY_SERVER_ENABLED } from "@/lib/utils/sentry-enabled";

Sentry.init({
  dsn: instanceConfig.sentryDsn ?? undefined,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.8,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  enabled: SENTRY_SERVER_ENABLED,

  // What an event may carry: see lib/utils/sentry-data-collection.ts (issue #38).
  dataCollection: SENTRY_DATA_COLLECTION,
});
