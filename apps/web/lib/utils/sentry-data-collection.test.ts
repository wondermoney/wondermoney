import assert from "node:assert/strict";

import { test } from "vitest";

import { SENTRY_DATA_COLLECTION } from "./sentry-data-collection";

// Sentry matches allow-list terms as case-insensitive substrings of the header or
// parameter name (`@sentry/core` filterKeyValueData), so this mirrors that rule.
function isAllowed(name: string, behaviour: unknown): boolean {
  if (behaviour === true) return true;
  if (!behaviour || typeof behaviour !== "object" || !("allow" in behaviour)) return false;
  const terms = (behaviour as { allow: string[] }).allow;
  return terms.some((term) => name.toLowerCase().includes(term.toLowerCase()));
}

const httpHeaders = SENTRY_DATA_COLLECTION.httpHeaders as {
  request: unknown;
  response: unknown;
};

test("no request or response body, cookie, user info or database/queue/AI payload is collected", () => {
  assert.deepEqual(SENTRY_DATA_COLLECTION.httpBodies, []);
  assert.equal(SENTRY_DATA_COLLECTION.cookies, false);
  assert.equal(SENTRY_DATA_COLLECTION.userInfo, false);
  assert.equal(SENTRY_DATA_COLLECTION.databaseQueryData, false);
  assert.equal(SENTRY_DATA_COLLECTION.queues, false);
  assert.deepEqual(SENTRY_DATA_COLLECTION.genAI, { inputs: false, outputs: false });
});

test("no auth, cookie, IP or referrer header gets through the header allow-lists", () => {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "set-cookie",
    "x-forwarded-for",
    "x-real-ip",
    "cf-connecting-ip",
    "referer",
    "x-api-key",
    "proxy-authorization",
  ];

  for (const header of sensitiveHeaders) {
    assert.equal(isAllowed(header, httpHeaders.request), false, `request header ${header}`);
    assert.equal(isAllowed(header, httpHeaders.response), false, `response header ${header}`);
  }
});

test("no token, OAuth code/state, email or account parameter gets through the query allow-list", () => {
  const sensitiveParams = [
    "token",
    "inviteToken",
    "code",
    "state",
    "email",
    "callbackURL",
    "accountKey",
    "amount",
    "searchTerm",
  ];

  for (const param of sensitiveParams) {
    assert.equal(isAllowed(param, SENTRY_DATA_COLLECTION.urlQueryParams), false, param);
  }
});
