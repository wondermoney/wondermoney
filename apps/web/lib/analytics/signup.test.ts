import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, it } from "vitest";

import {
  captureSignupFunnelEvent,
  SIGNUP_FUNNEL_EVENTS,
} from "./signup";

const consentValue = JSON.stringify({
  version: 1,
  necessary: true,
  analytics: true,
  ads: false,
  lifecycleEmail: false,
});

let originalAnalyticsFlag: string | undefined;
let originalWindow: PropertyDescriptor | undefined;

beforeEach(() => {
  originalAnalyticsFlag = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS;
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  process.env.NEXT_PUBLIC_ENABLE_ANALYTICS = "1";
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

describe("signup analytics isolation", () => {
  it("does not block auth when the analytics client throws", () => {
    // Given
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dataLayer: [],
        localStorage: { getItem: () => consentValue },
      },
    });
    const throwingClient = {
      capture() {
        throw new DOMException("Unavailable", "NetworkError");
      },
    };

    // When / Then
    assert.doesNotThrow(() =>
      captureSignupFunnelEvent(
        throwingClient,
        SIGNUP_FUNNEL_EVENTS.submitClicked,
        { locale: "pt", method: "email" },
      ),
    );
  });

  it("does not block auth when the analytics queue is unavailable", () => {
    // Given
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dataLayer: Object.freeze([]),
        localStorage: { getItem: () => consentValue },
      },
    });

    // When / Then
    assert.doesNotThrow(() =>
      captureSignupFunnelEvent(
        null,
        SIGNUP_FUNNEL_EVENTS.submitClicked,
        { locale: "en", method: "email" },
      ),
    );
  });
});
