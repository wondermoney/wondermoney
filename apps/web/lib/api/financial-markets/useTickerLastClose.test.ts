import assert from "node:assert/strict";

import { test } from "vitest";

import { selectLastClose } from "./useTickerLastClose";

const point = (date: string, close: number) => ({
  date,
  close,
  high: null,
  low: null,
  volume: null,
});

test("returns null when the window holds no usable close", () => {
  assert.equal(selectLastClose([]), null);
});

test("takes the latest close regardless of the order the series arrives in", () => {
  const descending = selectLastClose([
    point("2026-08-21", 232.5),
    point("2026-08-20", 230),
    point("2026-08-19", 228),
  ]);

  assert.equal(descending?.close, 232.5);
  assert.equal(descending?.date, "2026-08-21");
  assert.equal(descending?.previousClose, 230);
});

test("computes the day-over-day move against the previous close", () => {
  const result = selectLastClose([
    point("2026-08-20", 200),
    point("2026-08-21", 210),
  ]);

  assert.equal(result?.changePercentage, 5);
});

test("reports no change when there is nothing to compare against", () => {
  const single = selectLastClose([point("2026-08-21", 210)]);

  assert.equal(single?.close, 210);
  assert.equal(single?.previousClose, null);
  assert.equal(single?.changePercentage, null);
});

test("does not divide by a zero previous close", () => {
  const result = selectLastClose([
    point("2026-08-20", 0),
    point("2026-08-21", 210),
  ]);

  assert.equal(result?.changePercentage, null);
});
