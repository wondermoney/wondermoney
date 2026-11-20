// @vitest-environment jsdom
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";

import { ANALYTICS_CONSENT_KEY } from "./consent";
import { getConsentedLandingSource } from "./landing-source";

const fromLandingTool = new URLSearchParams("landing_source=toolMortgage");

afterEach(() => window.localStorage.clear());

describe("landing source on a signup", () => {
  it("is sent once the app's analytics consent is granted", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");

    assert.equal(getConsentedLandingSource(fromLandingTool), "toolMortgage");
  });

  it("is never sent on the website's consent alone", () => {
    assert.equal(getConsentedLandingSource(fromLandingTool), undefined);

    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
    assert.equal(getConsentedLandingSource(fromLandingTool), undefined);
  });

  it("drops a value that is not a route id", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");

    for (const value of ["https://example.com", "person@example.com", "tool-mortgage", ""]) {
      assert.equal(
        getConsentedLandingSource(new URLSearchParams({ landing_source: value })),
        undefined,
      );
    }
  });
});
