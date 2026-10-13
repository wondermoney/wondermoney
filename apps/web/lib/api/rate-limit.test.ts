import assert from "node:assert/strict";

import { test } from "vitest";

import {
  attachRateLimitInfo,
  DEFAULT_RATE_LIMIT_RETRY_SECONDS,
  getRateLimitInfo,
  getSecondsRemaining,
  isRateLimitError,
  MAX_RATE_LIMIT_RETRY_SECONDS,
  MIN_RATE_LIMIT_RETRY_SECONDS,
  RATE_LIMITED_ERROR_CODE,
} from "./rate-limit";

const NOW = Date.parse("2026-08-20T12:00:00Z");

function rateLimited({
  status = 429,
  data = { code: RATE_LIMITED_ERROR_CODE },
  headers = {},
}: {
  status?: number;
  data?: unknown;
  headers?: Record<string, unknown>;
} = {}) {
  return { response: { status, data, headers } };
}

test("detects a 429 by status", () => {
  const info = getRateLimitInfo(rateLimited({ data: {} }), NOW);

  assert.notEqual(info, null);
  assert.equal(isRateLimitError(rateLimited({ data: {} }), NOW), true);
});

test("detects RATE_LIMITED by body code even when the status is rewritten", () => {
  const info = getRateLimitInfo(
    rateLimited({ status: 400, data: { code: RATE_LIMITED_ERROR_CODE } }),
    NOW,
  );

  assert.notEqual(info, null);
});

test("a non-rate-limited error is not detected", () => {
  assert.equal(getRateLimitInfo({ response: { status: 500 } }, NOW), null);
  assert.equal(getRateLimitInfo({ response: { status: 401 } }, NOW), null);
  assert.equal(
    getRateLimitInfo(
      { response: { status: 403, data: { code: "demo_read_only" } } },
      NOW,
    ),
    null,
  );
  assert.equal(getRateLimitInfo(new Error("Network Error"), NOW), null);
  assert.equal(getRateLimitInfo(undefined, NOW), null);
  assert.equal(getRateLimitInfo("nope", NOW), null);
});

test("body retryAfter wins over the headers", () => {
  const info = getRateLimitInfo(
    rateLimited({
      data: { code: RATE_LIMITED_ERROR_CODE, retryAfter: 12 },
      headers: { "retry-after": "99" },
    }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, 12);
  assert.equal(info?.retryAfterMs, 12_000);
  assert.equal(info?.retryAfterKnown, true);
});

test("Retry-After drives the delay when the body omits it", () => {
  const info = getRateLimitInfo(
    rateLimited({ data: {}, headers: { "Retry-After": "45" } }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, 45);
  assert.equal(info?.retryAfterKnown, true);
});

test("Retry-After header lookup is case-insensitive", () => {
  for (const name of ["retry-after", "Retry-After", "RETRY-AFTER"]) {
    const info = getRateLimitInfo(
      rateLimited({ data: {}, headers: { [name]: "7" } }),
      NOW,
    );
    assert.equal(info?.retryAfterSeconds, 7, name);
  }
});

test("Retry-After reads from an AxiosHeaders-like getter", () => {
  const headers = {
    get(name: string) {
      return name.toLowerCase() === "retry-after" ? "20" : undefined;
    },
  };

  const info = getRateLimitInfo(rateLimited({ data: {}, headers }), NOW);
  assert.equal(info?.retryAfterSeconds, 20);
});

test("Retry-After as an HTTP-date is converted to seconds from now", () => {
  const info = getRateLimitInfo(
    rateLimited({
      data: {},
      headers: { "retry-after": new Date(NOW + 90_000).toUTCString() },
    }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, 90);
});

test("an HTTP-date already in the past falls back to the minimum, not to zero", () => {
  const info = getRateLimitInfo(
    rateLimited({
      data: {},
      headers: { "retry-after": new Date(NOW - 60_000).toUTCString() },
    }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, MIN_RATE_LIMIT_RETRY_SECONDS);
});

test("draft-7 RateLimit reset is used when Retry-After is absent", () => {
  const info = getRateLimitInfo(
    rateLimited({
      data: {},
      headers: { RateLimit: "limit=1200, remaining=0, reset=42" },
    }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, 42);
});

test("RateLimit-Reset is the last header consulted", () => {
  const info = getRateLimitInfo(
    rateLimited({ data: {}, headers: { "ratelimit-reset": "18" } }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, 18);
});

test("a missing Retry-After falls back to the default window", () => {
  const info = getRateLimitInfo(rateLimited({ data: {}, headers: {} }), NOW);

  assert.equal(info?.retryAfterSeconds, DEFAULT_RATE_LIMIT_RETRY_SECONDS);
  assert.equal(info?.retryAfterKnown, false);
});

test("garbage Retry-After values fall back to the default window", () => {
  for (const value of [
    "",
    "   ",
    "soon",
    "12abc",
    "NaN",
    "Infinity",
    null,
    {},
    [],
  ]) {
    const info = getRateLimitInfo(
      rateLimited({ data: {}, headers: { "retry-after": value } }),
      NOW,
    );

    assert.equal(
      info?.retryAfterSeconds,
      DEFAULT_RATE_LIMIT_RETRY_SECONDS,
      `Retry-After: ${JSON.stringify(value)}`,
    );
    assert.equal(info?.retryAfterKnown, false);
  }
});

test("a garbage body retryAfter still lets the header through", () => {
  const info = getRateLimitInfo(
    rateLimited({
      data: { code: RATE_LIMITED_ERROR_CODE, retryAfter: "later" },
      headers: { "retry-after": "9" },
    }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, 9);
});

test("Retry-After: 0 waits a beat rather than hammering immediately", () => {
  const info = getRateLimitInfo(
    rateLimited({ data: {}, headers: { "retry-after": "0" } }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, MIN_RATE_LIMIT_RETRY_SECONDS);
});

test("an absurd Retry-After is capped", () => {
  const info = getRateLimitInfo(
    rateLimited({ data: {}, headers: { "retry-after": "86400" } }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, MAX_RATE_LIMIT_RETRY_SECONDS);
});

test("fractional seconds round up so the retry never lands early", () => {
  const info = getRateLimitInfo(
    rateLimited({ data: { code: RATE_LIMITED_ERROR_CODE, retryAfter: 4.2 } }),
    NOW,
  );

  assert.equal(info?.retryAfterSeconds, 5);
});

test("family and message are carried through", () => {
  const info = getRateLimitInfo(
    rateLimited({
      data: {
        code: RATE_LIMITED_ERROR_CODE,
        family: "read",
        message: "Too many requests",
        retryAfter: 30,
      },
    }),
    NOW,
  );

  assert.equal(info?.family, "read");
  assert.equal(info?.message, "Too many requests");
});

test("attachRateLimitInfo pins the window measured at response time", () => {
  const error = attachRateLimitInfo(
    rateLimited({
      data: {},
      headers: { "retry-after": new Date(NOW + 60_000).toUTCString() },
    }),
    NOW,
  );

  // Read a minute later: without pinning, the date would now resolve to 0.
  const info = getRateLimitInfo(error, NOW + 60_000);
  assert.equal(info?.retryAfterSeconds, 60);
});

test("attachRateLimitInfo leaves other errors alone", () => {
  const error = { response: { status: 500 } };
  assert.equal(attachRateLimitInfo(error, NOW), error);
  assert.equal("rateLimit" in error, false);
});

test("getSecondsRemaining counts down and floors at zero", () => {
  assert.equal(getSecondsRemaining(NOW + 30_000, NOW), 30);
  assert.equal(getSecondsRemaining(NOW + 1, NOW), 1);
  assert.equal(getSecondsRemaining(NOW, NOW), 0);
  assert.equal(getSecondsRemaining(NOW - 10_000, NOW), 0);
  assert.equal(getSecondsRemaining(null, NOW), 0);
  assert.equal(getSecondsRemaining(undefined, NOW), 0);
  assert.equal(getSecondsRemaining(Number.NaN, NOW), 0);
});
