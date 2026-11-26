// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsentDecision, writeConsentDecision } from "./consent";
import { REFERRER_CLASS_STORAGE_KEY } from "./referrerClass";

type BeforeSend = (event: { properties: Record<string, unknown> }) => { properties: Record<string, unknown> };

const mocked = vi.hoisted(() => ({ options: undefined as undefined | { before_send: BeforeSend } }));

vi.mock("posthog-js", () => ({
  default: {
    init: (_key: string, options: { before_send: BeforeSend }) => {
      mocked.options = options;
    },
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}));

const allowAnalytics = (analytics: boolean) =>
  writeConsentDecision(window.localStorage, createConsentDecision({ analytics, ads: false }));

// A visit that arrived from a ChatGPT answer.
const arriveFromChatGpt = () => {
  window.history.replaceState(null, "", "/it?utm_source=chatgpt.com");
  Object.defineProperty(document, "referrer", { value: "https://chatgpt.com/", configurable: true });
};

async function loadPostHog() {
  vi.resetModules();
  mocked.options = undefined;
  const posthog = await import("./posthog");
  posthog.applyPostHogConsent({ analytics: true });
  await vi.waitFor(() => expect(mocked.options).toBeDefined());
  return { posthog, beforeSend: mocked.options!.before_send };
}

describe("PostHog and the referrer class", () => {
  beforeEach(arriveFromChatGpt);
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("adds referrer_class to an event only with analytics consent", async () => {
    allowAnalytics(true);
    const { beforeSend } = await loadPostHog();

    expect(beforeSend({ properties: {} }).properties.referrer_class).toBe("ai_assistant");

    allowAnalytics(false);
    expect(beforeSend({ properties: {} }).properties).not.toHaveProperty("referrer_class");
  });

  it("leaves PostHog's own referrer and campaign properties as they were", async () => {
    allowAnalytics(true);
    const { beforeSend } = await loadPostHog();

    const properties = { $referrer: "https://chatgpt.com/", $referring_domain: "chatgpt.com", utm_source: "chatgpt.com" };
    expect(beforeSend({ properties: { ...properties } }).properties).toMatchObject(properties);
  });

  it("forgets the kept class when consent is withdrawn", async () => {
    allowAnalytics(true);
    const { posthog, beforeSend } = await loadPostHog();
    beforeSend({ properties: {} });
    expect(window.sessionStorage.getItem(REFERRER_CLASS_STORAGE_KEY)).toBe("ai_assistant");

    allowAnalytics(false);
    posthog.applyPostHogConsent({ analytics: false });

    expect(window.sessionStorage.getItem(REFERRER_CLASS_STORAGE_KEY)).toBeNull();
  });
});
