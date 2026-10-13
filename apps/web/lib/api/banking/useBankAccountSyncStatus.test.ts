import assert from "node:assert/strict";

import { test } from "vitest";

import { getLegacyBankSyncStatus } from "../../account/legacy-bank-sync-status";

const requisition = (status: string, refreshedAt?: string) => ({
  requisition: {
    requisitionId: "never-send-this-to-diagnostics",
    status,
    accounts: refreshedAt ? [{ refreshedAt }] : [],
  },
}) as never;

test("legacy callback fallback only completes after refreshed account data", () => {
  assert.equal(
    getLegacyBankSyncStatus({
      enabled: true,
      isError: false,
      isFetched: true,
      data: requisition("linked", "2026-07-17T12:00:00Z"),
    }),
    "full_success",
  );
  assert.equal(
    getLegacyBankSyncStatus({
      enabled: true,
      isError: false,
      isFetched: true,
      data: requisition("error"),
    }),
    "failed",
  );
  assert.equal(
    getLegacyBankSyncStatus({
      enabled: true,
      isError: true,
      isFetched: true,
    }),
    "transport_unavailable",
  );
});
