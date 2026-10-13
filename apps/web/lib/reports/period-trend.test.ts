import assert from "node:assert/strict";

import { test } from "vitest";

import { periodTrend } from "./period-trend";

test("reports the change against a real prior period", () => {
  assert.deepEqual(periodTrend(1500, 1000), { delta: 500, percent: 50 });
  assert.deepEqual(periodTrend(800, 1000), { delta: -200, percent: -20 });
});

test("withholds the percentage when the prior period was zero", () => {
  // The bug: this reported 0%, so a report showing "+€1,230.83" sat beside
  // "(0%)" and read as "unchanged".
  assert.deepEqual(periodTrend(1230.83, 0), {
    delta: 1230.83,
    percent: undefined,
  });
});

test("keeps a genuine zero change distinct from an uncomputable one", () => {
  assert.deepEqual(periodTrend(1000, 1000), { delta: 0, percent: 0 });
  assert.deepEqual(periodTrend(0, 0), { delta: 0, percent: undefined });
});

test("uses the magnitude of the prior period so a negative baseline still reads correctly", () => {
  assert.deepEqual(periodTrend(-500, -1000), { delta: 500, percent: 50 });
});
