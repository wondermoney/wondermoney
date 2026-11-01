import assert from "node:assert/strict";

import { test } from "vitest";

import { getSafeNextPath, withNextParam } from "./safe-next-path";

const ORIGIN = "https://app.wonder.money";

// [input, expected] — `null` means "not safe: use the default landing page".
const CASES: ReadonlyArray<readonly [unknown, string | null]> = [
  // Accepted: same-origin relative paths, normalised to path + search + hash.
  ["/en/settings", "/en/settings"],
  ["/pt/accounts/42?tab=transactions", "/pt/accounts/42?tab=transactions"],
  ["/en/budgets#june", "/en/budgets#june"],
  ["/en/accounts?q=a%2Fb", "/en/accounts?q=a%2Fb"],
  ["/en/./settings", "/en/settings"],
  ["/es/goals", "/es/goals"],
  ["/en", "/en"],
  ["/pt?tab=x", "/pt?tab=x"],
  ["/en#top", "/en#top"],

  // Missing / not a string / empty.
  [null, null],
  [undefined, null],
  ["", null],
  [42, null],
  [["/en/settings"], null],

  // Not rooted at a single slash.
  ["en/settings", null],
  ["https://evil.example/", null],
  ["http://evil.example", null],
  ["javascript:alert(1)", null],
  ["JaVaScRiPt:alert(1)", null],
  ["data:text/html,<script>alert(1)</script>", null],
  [" /en/settings", null],
  ["\t/en/settings", null],

  // Protocol-relative and backslash variants.
  ["//evil.example", null],
  ["//evil.example/en/settings", null],
  ["///evil.example", null],
  ["/\\evil.example", null],
  ["\\\\evil.example", null],
  ["/en\\settings", null],

  // Encoded variants.
  ["/%2F%2Fevil.example", null],
  ["%2F%2Fevil.example", null],
  ["/%2fevil.example", null],
  ["/%5Cevil.example", null],
  ["/%5cevil.example", null],
  ["/%252F%252Fevil.example", null],
  ["/%E0%A4%A", null],

  // Control characters / whitespace browsers strip before parsing.
  ["/\t/evil.example", null],
  ["/\n/evil.example", null],
  ["/\r/evil.example", null],
  ["/%09/evil.example", null],
  ["/%00", null],

  // Resolves to another origin once parsed.
  ["/..//evil.example", null],
  ["/.//evil.example", null],

  // Outside the app's locale routes.
  ["/", null],
  ["/settings", null],
  ["/api/auth/sign-out", null],
  ["/health", null],
  ["/_next/static/chunks/app.js", null],
  ["/fr/settings", null],
  ["/EN/settings", null],
  ["/english/settings", null],
  ["/en-evil/settings", null],
  ["/?next=/en", null],
  ["/en/../api/auth/sign-out", null],
  ["/en/%2e%2e/api/auth/sign-out", null],
  ["/en/..%2F..%2Fapi", null],

  // Auth pages: landing back on login/MFA/complete would loop.
  ["/en/auth/login", null],
  ["/pt/auth/mfa?next=/en/settings", null],
  ["/auth/complete", null],

  // Absurdly long values.
  [`/${"a".repeat(4096)}`, null],
];

for (const [input, expected] of CASES) {
  test(`getSafeNextPath(${JSON.stringify(input)}) -> ${JSON.stringify(expected)}`, () => {
    assert.equal(getSafeNextPath(input, ORIGIN), expected);
  });
}

test("the origin's own path does not leak into the result", () => {
  assert.equal(
    getSafeNextPath("/en/settings", "https://app.wonder.money/some/base"),
    "/en/settings",
  );
});

test("withNextParam adds a safe next as a real query parameter", () => {
  assert.equal(
    withNextParam("/en/auth/mfa", "/en/accounts/1?tab=x"),
    "/en/auth/mfa?next=%2Fen%2Faccounts%2F1%3Ftab%3Dx",
  );
  assert.equal(
    withNextParam("https://app.wonder.money/en/auth/complete", "/en/settings"),
    "https://app.wonder.money/en/auth/complete?next=%2Fen%2Fsettings",
  );
});

test("withNextParam leaves the URL alone when there is no next", () => {
  assert.equal(withNextParam("/en/auth/mfa", null), "/en/auth/mfa");
  assert.equal(
    withNextParam("https://app.wonder.money/en/auth/complete", null),
    "https://app.wonder.money/en/auth/complete",
  );
});
