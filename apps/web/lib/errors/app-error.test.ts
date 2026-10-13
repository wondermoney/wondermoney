import assert from "node:assert/strict";

import { test } from "vitest";

import { classifyAppError, getErrorStatusCode } from "./app-error";

test("getErrorStatusCode reads axios-like response status", () => {
  assert.equal(getErrorStatusCode({ response: { status: 418 } }), 418);
});

test("getErrorStatusCode returns undefined for non-response errors", () => {
  assert.equal(getErrorStatusCode({ message: "no response" }), undefined);
  assert.equal(getErrorStatusCode({ response: { status: "503" } }), undefined);
  assert.equal(getErrorStatusCode(undefined), undefined);
});

test("classifyAppError maps known statuses", () => {
  assert.equal(classifyAppError({ response: { status: 429 } }), "rate-limit");
  assert.equal(classifyAppError({ response: { status: 401 } }), "auth");
  assert.equal(classifyAppError({ response: { status: 403 } }), "auth");
  assert.equal(classifyAppError({ response: { status: 404 } }), "not-found");
  assert.equal(classifyAppError({ response: { status: 500 } }), "service");
  assert.equal(classifyAppError({ response: { status: 503 } }), "service");
});

test("classifyAppError detects network failures", () => {
  assert.equal(classifyAppError(new Error("Network Error")), "network");
  assert.equal(
    classifyAppError(new Error("Failed to fetch")),
    "network",
  );
  assert.equal(
    classifyAppError(new Error("fetch failed due to timeout")),
    "network",
  );
});

test("classifyAppError falls back to unknown", () => {
  assert.equal(classifyAppError({ response: { status: 418 } }), "unknown");
  assert.equal(classifyAppError(new Error("boom")), "unknown");
});
