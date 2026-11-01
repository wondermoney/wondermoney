import assert from "node:assert/strict";

import type { ErrorEvent } from "@sentry/nextjs";
import { beforeAll, test, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  init: sentry.init,
  replayIntegration: () => ({}),
  captureException: () => {},
  captureMessage: () => {},
  captureRouterTransitionStart: () => {},
}));

import { initClientSentry } from "./sentry-client";

let beforeSend: (event: ErrorEvent) => ErrorEvent | null;

beforeAll(() => {
  initClientSentry();
  beforeSend = sentry.init.mock.calls[0][0].beforeSend;
});

const BRIDGE_NOISE =
  "undefined is not an object (evaluating 'window.webkit.messageHandlers')";

function errorEvent(type: string, value: string): ErrorEvent {
  return { type: undefined, exception: { values: [{ type, value }] } };
}

test("the iOS in-app-browser bridge error injected by third-party code is not reported", () => {
  assert.equal(beforeSend(errorEvent("TypeError", BRIDGE_NOISE)), null);
});

test("every other error is still reported", () => {
  const ours = errorEvent("TypeError", "undefined is not an object (evaluating 'account.balance')");
  const sameTextOtherType = errorEvent("Error", BRIDGE_NOISE);

  assert.equal(beforeSend(ours), ours);
  assert.equal(beforeSend(sameTextOtherType), sameTextOtherType);
});
