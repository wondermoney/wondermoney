import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import { getGtmId, isAnalyticsEnabled, isGtmEnabled } from "./analytics-enabled";

const env = vi.hoisted(
  () =>
    ({}) as {
      NEXT_PUBLIC_ENABLE_ANALYTICS?: "1";
      NEXT_PUBLIC_GTM_ID?: string;
      NEXT_PUBLIC_POSTHOG_KEY?: string;
    },
);
vi.mock("@/lib/utils/env", () => ({ env }));

afterEach(() => {
  vi.unstubAllEnvs();
  delete env.NEXT_PUBLIC_POSTHOG_KEY;
  delete env.NEXT_PUBLIC_GTM_ID;
  delete env.NEXT_PUBLIC_ENABLE_ANALYTICS;
});

/*
 * A self-hosted instance runs a production build with no analytics keys: it
 * must load no tracker at all. Only an operator-supplied key turns one on.
 */
test("a production build with no keys loads neither PostHog nor Google Tag Manager", () => {
  vi.stubEnv("NODE_ENV", "production");

  assert.equal(isAnalyticsEnabled(), false);
  assert.equal(isGtmEnabled(), false);
  assert.equal(getGtmId(), null);
});

test("NEXT_PUBLIC_GTM_ID turns on Google Tag Manager only", () => {
  vi.stubEnv("NODE_ENV", "production");
  env.NEXT_PUBLIC_GTM_ID = "GTM-TEST123";

  assert.equal(isGtmEnabled(), true);
  assert.equal(getGtmId(), "GTM-TEST123");
  assert.equal(isAnalyticsEnabled(), false);
});

test("NEXT_PUBLIC_POSTHOG_KEY turns on PostHog only", () => {
  vi.stubEnv("NODE_ENV", "production");
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";

  assert.equal(isAnalyticsEnabled(), true);
  assert.equal(isGtmEnabled(), false);
});

test("a blank GTM ID counts as unset", () => {
  vi.stubEnv("NODE_ENV", "production");
  env.NEXT_PUBLIC_GTM_ID = "   ";

  assert.equal(isGtmEnabled(), false);
  assert.equal(getGtmId(), null);
});

/*
 * A developer running a non-production build must not send analytics
 * anywhere, even with keys in .env.local, unless they ask for it.
 */
test("a non-production build tracks nothing by default, even with keys", () => {
  vi.stubEnv("NODE_ENV", "development");
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";
  env.NEXT_PUBLIC_GTM_ID = "GTM-TEST123";

  assert.equal(isAnalyticsEnabled(), false);
  assert.equal(isGtmEnabled(), false);
});

test("a non-production build tracks once analytics is enabled and keys are set", () => {
  vi.stubEnv("NODE_ENV", "development");
  env.NEXT_PUBLIC_ENABLE_ANALYTICS = "1";

  assert.equal(isAnalyticsEnabled(), false);
  assert.equal(isGtmEnabled(), false);

  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";
  env.NEXT_PUBLIC_GTM_ID = "GTM-TEST123";
  assert.equal(isAnalyticsEnabled(), true);
  assert.equal(isGtmEnabled(), true);
});
