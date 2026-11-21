import { ANALYTICS_EVENTS, createCatalogueCapture } from "@wondermoney/shared/analytics";
import posthog from "posthog-js";

/**
 * The one way web sends a product analytics event. It is typed by the event catalogue
 * (`@wondermoney/shared/analytics`, `packages/shared/lib/analytics/catalogue.ts`): only the
 * events whose surfaces include `web` can be named, each with exactly its properties. An event
 * that reaches it untyped and does not match is dropped. Consent is PostHog's own gate plus
 * `before_send` in AnalyticsInit, which also scrubs every event once more.
 *
 * A lint rule bans `posthog.capture` outside this folder (`eslint.config.mjs`). The files that
 * still call it predate the catalogue and move onto `track` with their renames (#625).
 */
export const track = createCatalogueCapture(
  ANALYTICS_EVENTS,
  "web",
  (event, properties) => {
    posthog.capture(event, properties);
  },
  (event, problems) => {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Analytics event ${event} dropped: ${problems.join("; ")}`);
    }
  },
);
