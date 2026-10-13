import assert from "node:assert/strict";

import { test } from "vitest";

import { buildOnboardingConnectRedirectPage } from "./connect-redirect";

test("builds a locale-prefixed relative path with no leading slash", () => {
  assert.equal(buildOnboardingConnectRedirectPage("en"), "en/onboarding/sync");
  assert.equal(buildOnboardingConnectRedirectPage("pt"), "pt/onboarding/sync");
});

test("strips leading slashes from a passed locale", () => {
  assert.equal(buildOnboardingConnectRedirectPage("/en"), "en/onboarding/sync");
});

test("falls back to 'en' for an unknown locale (never emits a bad path)", () => {
  assert.equal(buildOnboardingConnectRedirectPage("zz"), "en/onboarding/sync");
  assert.equal(buildOnboardingConnectRedirectPage(""), "en/onboarding/sync");
});
