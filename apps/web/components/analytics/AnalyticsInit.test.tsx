// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { AnalyticsInit } from "./AnalyticsInit";

const mocked = vi.hoisted(() => ({
  env: {} as { NEXT_PUBLIC_GTM_ID?: string; NEXT_PUBLIC_POSTHOG_KEY?: string },
  posthog: {
    __loaded: false,
    identify: vi.fn(),
    init: vi.fn(),
    startSessionRecording: vi.fn(),
  },
}));

vi.mock("@/lib/utils/env", () => ({ env: mocked.env }));
vi.mock("posthog-js", () => ({ default: mocked.posthog }));
vi.mock("@/lib/auth/user-context", () => ({ useUser: () => null }));

const trackerScripts = () =>
  [...document.querySelectorAll("script")].filter((script) =>
    /googletagmanager\.com|posthog\.com/.test(script.src),
  );

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  mocked.posthog.init.mockReset();
  mocked.posthog.startSessionRecording.mockReset();
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  vi.unstubAllEnvs();
  delete mocked.env.NEXT_PUBLIC_GTM_ID;
  delete mocked.env.NEXT_PUBLIC_POSTHOG_KEY;
});

// The self-hosting image is a production build; its default .env sets no keys.
test("a self-hosted instance with the default env loads no tracker", () => {
  render(<AnalyticsInit />);

  assert.deepEqual(trackerScripts(), []);
  assert.equal(mocked.posthog.init.mock.calls.length, 0);
});

test("NEXT_PUBLIC_GTM_ID loads that Google Tag Manager container and nothing else", () => {
  mocked.env.NEXT_PUBLIC_GTM_ID = "GTM-TEST123";

  render(<AnalyticsInit />);

  const scripts = trackerScripts();
  assert.equal(scripts.length, 1);
  assert.equal(
    scripts[0]?.src,
    "https://www.googletagmanager.com/gtm.js?id=GTM-TEST123",
  );
  assert.equal(mocked.posthog.init.mock.calls.length, 0);
});

test("NEXT_PUBLIC_POSTHOG_KEY starts PostHog without Google Tag Manager", () => {
  mocked.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";

  render(<AnalyticsInit />);

  assert.deepEqual(trackerScripts(), []);
  assert.equal(mocked.posthog.init.mock.calls[0]?.[0], "phc_key");
});
