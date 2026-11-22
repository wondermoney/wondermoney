import assert from "node:assert/strict";

import { test } from "vitest";

import { completeOfflineAccountCreation } from "./offline-account-success";

test("manual account success refetches, closes, resets, notifies and opens CSV import in order", async () => {
  const calls: string[] = [];

  await completeOfflineAccountCreation({
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
    "refetch",
    "close",
    "reset",
    "toast",
    "open-import",
  ]);
});
