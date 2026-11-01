import assert from "node:assert/strict";

import { test } from "vitest";

import { getAggregateFreshness } from "./accounts-freshness";

type TestAccount = NonNullable<
  Parameters<typeof getAggregateFreshness>[0]
>[number];

const account = (over: Record<string, unknown> = {}) =>
  ({
    accountKey: 1,
    name: "Test",
    balance: 0,
    syncStatus: null,
    refreshedAt: null,
    ...over,
  }) as unknown as TestAccount;

const older = "2026-08-14T09:00:00.000Z";
const newer = "2026-08-20T09:00:00.000Z";

test("with no synced accounts there is no 'as of' to report", () => {
  assert.equal(getAggregateFreshness(undefined), null);
  assert.equal(getAggregateFreshness([]), null);
  assert.equal(getAggregateFreshness([account(), account()]), null);
});

test("an unparseable timestamp is discarded rather than reported as Invalid Date", () => {
  assert.equal(
    getAggregateFreshness([account({ refreshedAt: "not-a-date" })]),
    null,
  );
});

test("a total is only as fresh as its stalest synced account", () => {
  const freshness = getAggregateFreshness([
    account({ syncStatus: { lastSyncedAt: newer, staleness: "fresh" } }),
    account({ syncStatus: { lastSyncedAt: older, staleness: "stale" } }),
    account(),
  ]);

  assert.ok(freshness);
  assert.equal(freshness.oldestSyncedAt.toISOString(), older);
  assert.equal(
    freshness.syncedCount,
    2,
    "manual accounts are not counted as synced",
  );
  assert.equal(freshness.isStale, true);
  assert.equal(freshness.hasError, false);
});

test("refreshedAt counts as a sync time when there is no structured status", () => {
  assert.equal(
    getAggregateFreshness([
      account({ refreshedAt: older }),
    ])?.oldestSyncedAt.toISOString(),
    older,
  );
});

test("a broken connection surfaces as an error on the aggregate", () => {
  const freshness = getAggregateFreshness([
    account({ syncStatus: { lastSyncedAt: newer, staleness: "error" } }),
  ]);
  assert.equal(freshness?.hasError, true);
});
