import assert from "node:assert/strict";

import { test } from "vitest";

import { parseOAuthConsentRequest } from "./oauth-consent";

test("reads the client, its redirect host and the scopes off a signed authorization request, keeping the query whole", () => {
  const query =
    "response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fx&scope=mcp%3Aread+offline_access&resource=https%3A%2F%2Fapi.example.test%2Fv1%2Fmcp&exp=1&sig=s1";

  const request = parseOAuthConsentRequest(`?${query}`);

  assert.deepEqual(request, {
    clientId: "abc",
    oauthQuery: query,
    redirectHost: "chatgpt.com",
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
