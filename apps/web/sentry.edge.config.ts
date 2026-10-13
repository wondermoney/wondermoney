// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { instanceConfig } from "@/lib/instance";
import { SENTRY_SERVER_ENABLED } from "@/lib/utils/sentry-enabled";

Sentry.init({
  dsn: instanceConfig.sentryDsn ?? undefined,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.8,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  enabled: SENTRY_SERVER_ENABLED,

  // Adds request headers and IP for users
  sendDefaultPii: true,
});
