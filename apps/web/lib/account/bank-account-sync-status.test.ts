import assert from "node:assert/strict";

import { test } from "vitest";

import {
  getBankAccountSyncRefetchInterval,
  getBankAccountSyncStatus,
} from "./bank-account-sync-status";

test("returns idle when there is no requisition id", () => {
  assert.equal(
    getBankAccountSyncStatus({
      hasRequisitionId: false,
      isError: false,
      isFetched: false,
      requisition: undefined,
    }),
    "idle",
  );
});

test("keeps processing while the requisition is loading", () => {
  assert.equal(
    getBankAccountSyncStatus({
      hasRequisitionId: true,
      isError: false,
      isFetched: false,
      requisition: undefined,
    }),
    "processing",
  );
});

test("returns error when the query failed", () => {
  assert.equal(
    getBankAccountSyncStatus({
      hasRequisitionId: true,
      isError: true,
      isFetched: true,
      requisition: undefined,
    }),
    "error",
  );
});

test("returns error when fetched requisition is missing", () => {
  assert.equal(
    getBankAccountSyncStatus({
      hasRequisitionId: true,
      isError: false,
      isFetched: true,
      requisition: null,
    }),
    "error",
  );
});

test("returns error for failed requisition statuses", () => {
  for (const status of ["error", "expired"]) {
    assert.equal(
      getBankAccountSyncStatus({
        hasRequisitionId: true,
        isError: false,
        isFetched: true,
        requisition: {
          requisitionId: "req_1",
          status,
          accounts: [],
        },
      }),
      "error",
    );
  }
});

test("keeps processing until accounts exist and are refreshed", () => {
  assert.equal(
    getBankAccountSyncStatus({
      hasRequisitionId: true,
      isError: false,
      isFetched: true,
      requisition: {
        requisitionId: "req_1",
        status: "linked",
        accounts: [],
      },
    }),
    "processing",
  );

  assert.equal(
    getBankAccountSyncStatus({
      hasRequisitionId: true,
      isError: false,
      isFetched: true,
      requisition: {
        requisitionId: "req_1",
        status: "linked",
        accounts: [{ refreshedAt: "2026-05-23T12:00:00.000Z" }, {}],
      },
    }),
    "processing",
  );
});

test("returns ready when all accounts are refreshed", () => {
  assert.equal(
    getBankAccountSyncStatus({
      hasRequisitionId: true,
      isError: false,
      isFetched: true,
      requisition: {
        requisitionId: "req_1",
        status: "linked",
        accounts: [
          { refreshedAt: "2026-05-23T12:00:00.000Z" },
          { refreshedAt: "2026-05-23T12:00:01.000Z" },
        ],
      },
    }),
    "ready",
  );
});

test("polls only while processing", () => {
  assert.equal(getBankAccountSyncRefetchInterval("processing"), 2500);
  assert.equal(getBankAccountSyncRefetchInterval("idle"), false);
  assert.equal(getBankAccountSyncRefetchInterval("ready"), false);
  assert.equal(getBankAccountSyncRefetchInterval("error"), false);
});
