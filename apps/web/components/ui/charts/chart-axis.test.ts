import assert from "node:assert/strict";

import { test } from "vitest";

import {
  estimateYAxisWidth,
  niceTicks,
  pickDateAxisTicks,
  truncateAxisLabel,
} from "./chart-axis";

test("spaces every tick by the same rounded step", () => {
  const ticks = niceTicks(239.15, 347.56, 5);

  assert.ok(ticks.length >= 4);
  const steps = ticks.slice(1).map((tick, index) => tick - ticks[index]);
  for (const step of steps) {
    assert.ok(
      Math.abs(step - steps[0]) < 1e-9,
      `expected a constant step, got ${steps.join(", ")}`,
    );
  }
});

test("covers the data range it was given", () => {
  const ticks = niceTicks(239.15, 347.56, 5);

  assert.ok(ticks[0] <= 239.15);
  assert.ok(ticks[ticks.length - 1] >= 347.56);
});

test("does not produce floating point noise", () => {
  for (const tick of niceTicks(0, 1, 5)) {
    assert.equal(tick, Number(tick.toFixed(6)));
  }
});

test("gives a flat series a window with height", () => {
  const ticks = niceTicks(100, 100, 5);

  assert.ok(ticks.length >= 2);
  assert.ok(ticks[0] < 100);
  assert.ok(ticks[ticks.length - 1] > 100);
});

test("survives an empty or non-finite range", () => {
  assert.deepEqual(niceTicks(Number.NaN, 10), []);
});

test("labels month starts over a long span", () => {
  const dates: string[] = [];
  for (let day = 0; day < 240; day += 1) {
    const date = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000);
    dates.push(date.toISOString().slice(0, 10));
  }

  const ticks = pickDateAxisTicks(dates, 8);

  assert.ok(ticks.length <= 8);
  assert.ok(ticks.every((tick) => dates.includes(tick)));
  assert.ok(ticks.every((tick) => tick.endsWith("-01")));
});

test("keeps every point on a short span", () => {
  const dates = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"];

  assert.deepEqual(pickDateAxisTicks(dates, 8), dates);
});

test("never returns more ticks than asked for", () => {
  const dates: string[] = [];
  for (let day = 0; day < 40; day += 1) {
    const date = new Date(Date.UTC(2026, 5, 1) + day * 86_400_000);
    dates.push(date.toISOString().slice(0, 10));
  }

  assert.ok(pickDateAxisTicks(dates, 5).length <= 5);
});

// A category axis (long free-text names like "Cafe, Restaurants &
// Bars") needs more room than the 96px currency-label cap, or Recharts draws
// the full string and the SVG's default overflow:hidden clips it raw.
test("estimateYAxisWidth honours a wider cap for long category labels", () => {
  const width = estimateYAxisWidth(
    ["Cafe, Restaurants & Bars", "Uncategorized"],
    76,
    160,
  );

  assert.ok(width > 96, `expected width above the currency cap, got ${width}`);
  assert.ok(width <= 160, `expected width capped at 160, got ${width}`);
});

test("estimateYAxisWidth keeps the original 96px cap by default", () => {
  const width = estimateYAxisWidth(["Cafe, Restaurants & Bars"], 76);

  assert.equal(width, 96);
});

test("truncateAxisLabel leaves short labels untouched", () => {
  assert.equal(truncateAxisLabel("Food", 20), "Food");
});

test("truncateAxisLabel ellipsizes rather than raw-clipping an oversized label", () => {
  const truncated = truncateAxisLabel("CAFE_RESTAURANTS_BARS", 10);

  assert.equal(truncated, "CAFE_REST…");
  assert.ok(truncated.length <= 10);
});
