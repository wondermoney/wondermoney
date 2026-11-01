import assert from "node:assert/strict";

import { test } from "vitest";

import { clampSyncedAt } from "./sync-time";

const now = Date.parse("2026-10-25T12:00:00.000Z");

test("a sync time in the future reads as now", () => {
  assert.equal(
    clampSyncedAt("2046-10-25T18:30:28.658Z", now),
    "2026-10-25T12:00:00.000Z",
  );
  assert.equal(
    clampSyncedAt(new Date("2046-10-25T18:30:28.658Z"), now)?.getTime(),
    now,
  );
});

test("a past sync time, a missing one and an unparseable one pass through", () => {
  assert.equal(
    clampSyncedAt("2026-10-24T08:00:00.000Z", now),
    "2026-10-24T08:00:00.000Z",
  );
  assert.equal(clampSyncedAt(null, now), null);
  assert.equal(clampSyncedAt(undefined, now), undefined);
  assert.equal(clampSyncedAt("not a date", now), "not a date");
});
