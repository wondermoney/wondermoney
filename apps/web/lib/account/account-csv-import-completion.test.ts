import assert from "node:assert/strict";

import { test } from "vitest";

import { notifyAccountCsvImportSuccess } from "./account-csv-import-completion";

test("notifies once after the authoritative CSV operation succeeds", () => {
  const tracker = { current: undefined };
  let calls = 0;
  const notify = () =>
    notifyAccountCsvImportSuccess({
      authoritativeCorrelationId: "operation-1",
      authoritativeStatus: "succeeded",
      correlationId: "operation-1",
      onSuccess: () => {
        calls += 1;
      },
      tracker,
    });

  assert.equal(notify(), true);
  assert.equal(notify(), false);
  assert.equal(calls, 1);
});

test("does not notify for failed, retryable, or mismatched operation state", () => {
  const tracker = { current: undefined };
  let calls = 0;

  for (const authoritativeStatus of ["failed", "partial", "needs_action"]) {
    assert.equal(
      notifyAccountCsvImportSuccess({
        authoritativeCorrelationId: "operation-1",
        authoritativeStatus,
        correlationId: "operation-1",
        onSuccess: () => {
          calls += 1;
        },
        tracker,
      }),
      false,
    );
  }

  assert.equal(
    notifyAccountCsvImportSuccess({
      authoritativeCorrelationId: "stale-operation",
      authoritativeStatus: "succeeded",
      correlationId: "operation-1",
      onSuccess: () => {
        calls += 1;
      },
      tracker,
    }),
    false,
  );
  assert.equal(calls, 0);
  assert.equal(tracker.current, undefined);
});
