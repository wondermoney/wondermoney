import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import { isAnalyticsEnabled, isGtmEnabled } from "./analytics-enabled";

const env = vi.hoisted(
  () =>
    ({}) as {
      NEXT_PUBLIC_POSTHOG_KEY?: string;
      NEXT_PUBLIC_ENABLE_ANALYTICS?: "1";
    },
);
vi.mock("@/lib/utils/env", () => ({ env }));

afterEach(() => {
  vi.unstubAllEnvs();
  delete env.NEXT_PUBLIC_POSTHOG_KEY;
  delete env.NEXT_PUBLIC_ENABLE_ANALYTICS;
});

/*
 * A developer or a self-hoster running a non-production build must not send
 * product analytics anywhere unless they ask for it.
 */
test("a non-production build tracks nothing by default, even with a PostHog key", () => {
  vi.stubEnv("NODE_ENV", "development");
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";

  assert.equal(isAnalyticsEnabled(), false);
  assert.equal(isGtmEnabled(), false);
});

test("a non-production build tracks once analytics is explicitly enabled", () => {
  vi.stubEnv("NODE_ENV", "development");
  env.NEXT_PUBLIC_ENABLE_ANALYTICS = "1";
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";

  assert.equal(isAnalyticsEnabled(), true);
  assert.equal(isGtmEnabled(), true);
});

test("production tracks with PostHog only when a key is configured", () => {
  vi.stubEnv("NODE_ENV", "production");

  assert.equal(isAnalyticsEnabled(), false);

  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";
  assert.equal(isAnalyticsEnabled(), true);
});

test("Google Tag Manager does not depend on a PostHog key", () => {
  vi.stubEnv("NODE_ENV", "production");

  assert.equal(isGtmEnabled(), true);
});
