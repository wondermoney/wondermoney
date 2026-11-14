// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, test, vi } from "vitest";

import {
  ANALYTICS_CONSENT_KEY,
  setAnalyticsConsent,
} from "@/lib/analytics/consent";

import { AnalyticsInit } from "./AnalyticsInit";

const mocked = vi.hoisted(() => ({
  env: {} as { NEXT_PUBLIC_GTM_ID?: string; NEXT_PUBLIC_POSTHOG_KEY?: string },
  posthog: {
    __loaded: false,
    identify: vi.fn(),
    init: vi.fn(),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
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
  mocked.posthog.identify.mockClear();
  mocked.posthog.opt_out_capturing.mockClear();
  mocked.posthog.__loaded = false;
  window.localStorage.clear();
});

test("explicit opt-in starts usage analytics without replay or identification, and withdrawal blocks events", () => {
  mocked.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";
  mocked.env.NEXT_PUBLIC_GTM_ID = "GTM-TEST123";
  mocked.posthog.init.mockImplementation(() => {
    mocked.posthog.__loaded = true;
  });
  render(<AnalyticsInit />);
  act(() => setAnalyticsConsent("granted"));

  const options = mocked.posthog.init.mock.calls[0]?.[1];
  assert.equal(options.disable_session_recording, true);
  assert.equal(options.person_profiles, "never");
  assert.equal(mocked.posthog.startSessionRecording.mock.calls.length, 0);
  assert.equal(mocked.posthog.identify.mock.calls.length, 0);
  assert.equal(trackerScripts().length, 1);
  const event = { event: "account_added", properties: {} };
  assert.equal(options.before_send(event), event);

  act(() => setAnalyticsConsent("denied"));
  assert.equal(options.before_send(event), null);
  assert.equal(mocked.posthog.opt_out_capturing.mock.calls.length, 1);
  assert.equal(trackerScripts().length, 0);
});

test("a saved refusal survives a reload", () => {
  mocked.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
  render(<AnalyticsInit />);
  assert.equal(mocked.posthog.init.mock.calls.length, 0);
});

test("unavailable consent storage leaves tracking off", () => {
  mocked.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  render(<AnalyticsInit />);
  assert.equal(mocked.posthog.init.mock.calls.length, 0);
  get.mockRestore();
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

test("a configured Google Tag Manager waits for consent", () => {
  mocked.env.NEXT_PUBLIC_GTM_ID = "GTM-TEST123";

  render(<AnalyticsInit />);

  const scripts = trackerScripts();
  assert.equal(scripts.length, 0);
  assert.equal(mocked.posthog.init.mock.calls.length, 0);
});

test("a configured PostHog waits for consent", () => {
  mocked.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_key";

  render(<AnalyticsInit />);

  assert.deepEqual(trackerScripts(), []);
  assert.equal(mocked.posthog.init.mock.calls.length, 0);
});
