import assert from "node:assert/strict";

import { test } from "vitest";

import { getSanitizedPageviewUrl } from "./pageview-url";

test("strips credentials and signup bookkeeping but keeps ordinary params", () => {
  assert.equal(
    getSanitizedPageviewUrl(
      "https://app.wonder.money",
      "/pt/example",
      new URLSearchParams("token=secret&signup_completed=1&safe=value"),
    ),
    "https://app.wonder.money/pt/example?safe=value",
  );
});

test("drops the query string entirely when nothing safe remains", () => {
  assert.equal(
    getSanitizedPageviewUrl(
      "https://app.wonder.money",
      "/pt/example",
      new URLSearchParams("code=abc"),
    ),
    "https://app.wonder.money/pt/example",
  );
});
