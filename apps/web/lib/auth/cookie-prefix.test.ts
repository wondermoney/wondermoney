import assert from "node:assert/strict";

import { test } from "vitest";

import { getBetterAuthCookiePrefix } from "./cookie-prefix";

test("uses a production-only Better Auth cookie prefix", () => {
  assert.equal(
    getBetterAuthCookiePrefix("https://api.wonder.money"),
    "prod.better-auth",
  );
  assert.equal(
    getBetterAuthCookiePrefix("https://staging.api.wonder.money"),
    undefined,
  );
  assert.equal(
    getBetterAuthCookiePrefix("http://localhost:3001"),
    undefined,
  );
  assert.equal(getBetterAuthCookiePrefix(undefined), undefined);
  assert.equal(getBetterAuthCookiePrefix("not a URL"), undefined);
});
