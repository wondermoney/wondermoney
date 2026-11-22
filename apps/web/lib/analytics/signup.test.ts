import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { captureSignupFunnelEvent, SIGNUP_FUNNEL_EVENTS } from "./signup";
import { track } from "./track";

vi.mock("./track", () => ({ track: vi.fn() }));

const tracked = vi.mocked(track);
const consentValue = "granted";

let originalAnalyticsFlag: string | undefined;
let originalWindow: PropertyDescriptor | undefined;

function givenWindow(dataLayer: unknown[], consent: null | string) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dataLayer, localStorage: { getItem: () => consent } },
  });
}

beforeEach(() => {
  originalAnalyticsFlag = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS;
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  process.env.NEXT_PUBLIC_ENABLE_ANALYTICS = "1";
  tracked.mockReset();
});

afterEach(() => {
  if (originalAnalyticsFlag === undefined) {
    delete process.env.NEXT_PUBLIC_ENABLE_ANALYTICS;
  } else {
    process.env.NEXT_PUBLIC_ENABLE_ANALYTICS = originalAnalyticsFlag;
  }

  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("signup analytics", () => {
  it("sends neither an event nor a tag-manager event without opt-in", () => {
    const dataLayer: unknown[] = [];
    givenWindow(dataLayer, null);

    captureSignupFunnelEvent(SIGNUP_FUNNEL_EVENTS.started);

    assert.equal(tracked.mock.calls.length, 0);
    assert.deepEqual(dataLayer, []);
  });

  it("sends PostHog only the catalogue's steps, and every step to the tag manager", () => {
    const dataLayer: unknown[] = [];
    givenWindow(dataLayer, consentValue);

    captureSignupFunnelEvent(SIGNUP_FUNNEL_EVENTS.started, { locale: "pt" });
    captureSignupFunnelEvent(SIGNUP_FUNNEL_EVENTS.submitClicked);
    captureSignupFunnelEvent(SIGNUP_FUNNEL_EVENTS.submitFailed, {
      failure_category: "recaptcha",
      locale: "pt",
    });
    captureSignupFunnelEvent(SIGNUP_FUNNEL_EVENTS.completed, {
      method: "email",
      source: "signup_form",
    });

    assert.deepEqual(tracked.mock.calls, [
      ["signup_started"],
      ["signup_failed", { reason: "recaptcha" }],
    ]);
    assert.deepEqual(dataLayer, [
      { event: "signup_started", locale: "pt" },
      { event: "signup_submit_clicked" },
      { event: "signup_submit_failed", failure_category: "recaptcha", locale: "pt" },
      { event: "signup_completed", method: "email", source: "signup_form" },
    ]);
  });

  it("does not block auth when the analytics client throws", () => {
    givenWindow([], consentValue);
    tracked.mockImplementation(() => {
      throw new DOMException("Unavailable", "NetworkError");
    });

    assert.doesNotThrow(() =>
      captureSignupFunnelEvent(SIGNUP_FUNNEL_EVENTS.started, { locale: "pt" }),
    );
  });

  it("does not block auth when the analytics queue is unavailable", () => {
    givenWindow(Object.freeze([]) as unknown as unknown[], consentValue);

    assert.doesNotThrow(() =>
      captureSignupFunnelEvent(SIGNUP_FUNNEL_EVENTS.submitClicked, {
        locale: "en",
        method: "email",
      }),
    );
  });
});
