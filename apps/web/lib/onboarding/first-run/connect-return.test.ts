import assert from "node:assert/strict";

import { test } from "vitest";

import { connectReturnPatch, resolveConnectReturn } from "./connect-return";

const params = (q: string) => new URLSearchParams(q);

test("no nordingen origin -> none", () => {
  assert.deepEqual(resolveConnectReturn(params("")), { kind: "none" });
  assert.deepEqual(resolveConnectReturn(params("sync=abc")), { kind: "none" });
});

test("success -> connected with incidentId", () => {
  assert.deepEqual(resolveConnectReturn(params("origin=nordingen&sync=abc")), {
    kind: "connected",
    incidentId: "abc",
  });
});

test("success without incident -> connected, no id", () => {
  assert.deepEqual(resolveConnectReturn(params("origin=nordingen")), {
    kind: "connected",
    incidentId: undefined,
  });
});

test("cancelled / requisition_not_found -> error_not_linked", () => {
  for (const err of ["cancelled", "requisition_not_found"]) {
    assert.deepEqual(
      resolveConnectReturn(params(`origin=nordingen&err=${err}`)),
      { kind: "error_not_linked", error: err },
    );
  }
});

test("queue_unavailable with incident -> error_sync_trouble", () => {
  assert.deepEqual(
    resolveConnectReturn(params("origin=nordingen&err=queue_unavailable&sync=xyz")),
    { kind: "error_sync_trouble", error: "queue_unavailable", incidentId: "xyz" },
  );
});

test("queue_unavailable without incident -> still error_sync_trouble", () => {
  // RAD-588: the enqueue can throw before an incident id is allocated, but the
  // requisition is already linked by then. Routing this to error_not_linked told
  // users a working bank connection had failed.
  assert.deepEqual(
    resolveConnectReturn(params("origin=nordingen&err=queue_unavailable")),
    { kind: "error_sync_trouble", error: "queue_unavailable", incidentId: undefined },
  );
  assert.deepEqual(
    connectReturnPatch(
      resolveConnectReturn(params("origin=nordingen&err=queue_unavailable")),
    ),
    { accountStep: "connected", currentStep: "sync_value" },
  );
});

test("unknown error with incident -> sync_trouble; without -> not_linked", () => {
  assert.equal(
    resolveConnectReturn(params("origin=nordingen&err=weird&sync=xyz")).kind,
    "error_sync_trouble",
  );
  assert.equal(
    resolveConnectReturn(params("origin=nordingen&err=weird")).kind,
    "error_not_linked",
  );
});

test("connectReturnPatch marks connected only for connected/sync_trouble", () => {
  assert.deepEqual(connectReturnPatch({ kind: "connected", incidentId: "a" }), {
    accountStep: "connected",
    currentStep: "sync_value",
  });
  assert.deepEqual(
    connectReturnPatch({ kind: "error_sync_trouble", error: "queue_unavailable", incidentId: "a" }),
    { accountStep: "connected", currentStep: "sync_value" },
  );
  assert.equal(connectReturnPatch({ kind: "error_not_linked", error: "cancelled" }), null);
  assert.equal(connectReturnPatch({ kind: "none" }), null);
});
