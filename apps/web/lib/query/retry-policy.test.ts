import assert from "node:assert/strict";

import { test } from "vitest";

import { RATE_LIMITED_ERROR_CODE } from "@/lib/api/rate-limit";
import { createRateLimitCoordinator } from "@/lib/api/rate-limit-coordinator";
import { classifyAppError } from "@/lib/errors/app-error";

import {
  DEFAULT_QUERY_RETRIES,
  getQueryRetryDelayMs,
  MAX_QUERY_RETRY_DELAY_MS,
  shouldRetryQuery,
} from "./retry-policy";

const NOW = Date.parse("2026-08-20T12:00:00Z");

function rateLimitedError(headers: Record<string, string> = {}) {
  return {
    response: {
      status: 429,
      data: { code: RATE_LIMITED_ERROR_CODE, family: "read" },
      headers,
    },
  };
}

function coordinatorAt(nowMs: number) {
  return createRateLimitCoordinator({ now: () => nowMs, random: () => 0 });
}

test("a 429 maps to the rate-limited state, not the error state", () => {
  assert.equal(classifyAppError(rateLimitedError()), "rate-limit");
});

test("a RATE_LIMITED body maps to rate-limit even without a 429 status", () => {
  assert.equal(
    classifyAppError({
      response: { status: 400, data: { code: RATE_LIMITED_ERROR_CODE } },
    }),
    "rate-limit",
  );
});

test("an ordinary server error still maps to the error state", () => {
  assert.equal(classifyAppError({ response: { status: 500 } }), "service");
});

test("a 429 is not retried behind a spinner", () => {
  // The calm state owns the wait; React Query settling immediately is what
  // makes it renderable at all.
  assert.equal(shouldRetryQuery(0, rateLimitedError()), false);
  assert.equal(shouldRetryQuery(1, rateLimitedError()), false);
});

test("a 401 is still never retried", () => {
  assert.equal(shouldRetryQuery(0, { response: { status: 401 } }), false);
});

test("ordinary failures keep the existing two-attempt budget", () => {
  const error = { response: { status: 500 } };

  for (let attempt = 0; attempt < DEFAULT_QUERY_RETRIES; attempt += 1) {
    assert.equal(shouldRetryQuery(attempt, error), true);
  }
  assert.equal(shouldRetryQuery(DEFAULT_QUERY_RETRIES, error), false);
});

test("Retry-After drives the delay, not the exponential backoff", () => {
  const delay = getQueryRetryDelayMs(
    0,
    rateLimitedError({ "retry-after": "45" }),
    coordinatorAt(NOW),
  );

  assert.equal(delay, 45_000);
});

test("a later failure count does not shorten or lengthen a Retry-After wait", () => {
  const coordinator = coordinatorAt(NOW);
  const error = rateLimitedError({ "retry-after": "20" });

  assert.equal(getQueryRetryDelayMs(0, error, coordinator), 20_000);
  // Second waiter on the same window: same countdown, one stagger slot later.
  assert.equal(getQueryRetryDelayMs(3, error, coordinator), 20_250);
});

test("a missing Retry-After falls back to the default window, not to 1s", () => {
  const delay = getQueryRetryDelayMs(0, rateLimitedError(), coordinatorAt(NOW));

  assert.equal(delay, 30_000);
});

test("a garbage Retry-After falls back to the default window", () => {
  const delay = getQueryRetryDelayMs(
    0,
    rateLimitedError({ "retry-after": "whenever" }),
    coordinatorAt(NOW),
  );

  assert.equal(delay, 30_000);
});

test("non-rate-limit errors keep exponential backoff", () => {
  const error = { response: { status: 500 } };

  assert.equal(getQueryRetryDelayMs(0, error, coordinatorAt(NOW)), 1000);
  assert.equal(getQueryRetryDelayMs(1, error, coordinatorAt(NOW)), 2000);
  assert.equal(
    getQueryRetryDelayMs(20, error, coordinatorAt(NOW)),
    MAX_QUERY_RETRY_DELAY_MS,
  );
});
