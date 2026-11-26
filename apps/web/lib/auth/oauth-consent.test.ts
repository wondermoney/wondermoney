import assert from "node:assert/strict";

import { test } from "vitest";

import {
  describeRedirect,
  isSessionFreshForConsent,
  parseOAuthConsentRequest,
} from "./oauth-consent";

test("reads the client, its redirect host and the scopes off a signed authorization request, keeping the query whole", () => {
  const query =
    "response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fx&scope=mcp%3Aread+offline_access&resource=https%3A%2F%2Fapi.example.test%2Fv1%2Fmcp&exp=1&sig=s1";

  const request = parseOAuthConsentRequest(`?${query}`);

  assert.deepEqual(request, {
    clientId: "abc",
    oauthQuery: query,
    redirect: { kind: "web", origin: "https://chatgpt.com" },
    scopes: ["mcp:read", "offline_access"],
  });
});

test("is not a consent request without a client or a signature", () => {
  assert.equal(
    parseOAuthConsentRequest("client_id=abc&scope=mcp%3Aread"),
    null,
  );
  assert.equal(parseOAuthConsentRequest("sig=s1&scope=mcp%3Aread"), null);
});

test("names a website by its https origin, and anything else as an app on this device, never by a borrowed host", () => {
  assert.deepEqual(describeRedirect("https://chatgpt.com/connector/oauth/x"), {
    kind: "web",
    origin: "https://chatgpt.com",
  });
  assert.deepEqual(describeRedirect("evilapp://chatgpt.com/oauth/callback"), {
    kind: "device",
    label: "evilapp:",
  });
  assert.deepEqual(describeRedirect("http://127.0.0.1:8976/callback"), {
    kind: "device",
    label: "http://127.0.0.1:8976",
  });
  assert.deepEqual(describeRedirect("http://chatgpt.com/callback"), {
    kind: "device",
    label: "http:",
  });
  assert.equal(describeRedirect("not a url"), null);
});

test("treats a session as fresh for consent for a day after sign-in", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  assert.equal(isSessionFreshForConsent("2026-11-26T01:00:00Z", now), true);
  assert.equal(isSessionFreshForConsent("2026-11-24T12:00:00Z", now), false);
  assert.equal(isSessionFreshForConsent(undefined, now), false);
});
