import assert from "node:assert/strict";

import { test } from "vitest";

import {
  safeDiagnosticCaptureException,
  safelyRunDiagnostic,
  safePostHogCapture,
} from "./safe-diagnostics";

test("Task15 diagnostics fail open when PostHog or Sentry throws", () => {
  let continued = false;

  assert.doesNotThrow(() => {
    safePostHogCapture(
      { capture: () => void (() => { throw new Error("posthog unavailable"); })() },
      "bank_sync_recovery_displayed",
    );
    safeDiagnosticCaptureException(() => {
      throw new Error("sentry unavailable");
    }, new Error("sync failed"));
    safelyRunDiagnostic(() => {
      throw new Error("diagnostic unavailable");
    });
    continued = true;
  });

  assert.equal(continued, true);
});
