import assert from "node:assert/strict";

import { test } from "vitest";

import { completeOfflineAccountCreation } from "./offline-account-success";

test("manual account success refetches and opens CSV import when analytics throws", async () => {
  const calls: string[] = [];

  await completeOfflineAccountCreation({
    analytics: {
      capture: () => {
        calls.push("capture");
        throw new Error("analytics unavailable");
      },
    },
    analyticsProperties: { connection_type: "manual" },
    invalidateAccounts: async () => {
      calls.push("refetch");
    },
    closeModal: () => calls.push("close"),
    resetForm: () => calls.push("reset"),
    notifySuccess: () => calls.push("toast"),
    onSuccess: () => {
      calls.push("open-import");
    },
  });

  assert.deepEqual(calls, [
    "capture",
    "refetch",
    "close",
    "reset",
    "toast",
    "open-import",
  ]);
});
