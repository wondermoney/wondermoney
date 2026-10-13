import assert from "node:assert/strict";

import { test } from "vitest";

import { selectPriceStatistics } from "./useTickerPriceStatistics";

const point = (
  date: string,
  close: number,
  extras: { high?: number | null; low?: number | null; volume?: number | null } = {},
) => ({
  date,
  close,
  high: extras.high ?? null,
  low: extras.low ?? null,
  volume: extras.volume ?? null,
});

test("returns null for an empty series", () => {
  assert.equal(selectPriceStatistics([]), null);
});

test("uses intraday extremes for the 52-week range when the provider sends them", () => {
  const stats = selectPriceStatistics([
    point("2026-08-19", 100, { high: 105, low: 95 }),
    point("2026-08-20", 110, { high: 120, low: 108 }),
  ]);

  assert.equal(stats?.yearHigh, 120);
  assert.equal(stats?.yearLow, 95);
});

test("falls back to closes when the series carries no highs or lows", () => {
  const stats = selectPriceStatistics([
    point("2026-08-19", 100),
    point("2026-08-20", 130),
  ]);

  assert.equal(stats?.yearHigh, 130);
  assert.equal(stats?.yearLow, 100);
});

test("averages only the sessions that report a volume", () => {
  const stats = selectPriceStatistics([
    point("2026-08-19", 100, { volume: 100 }),
    point("2026-08-20", 100, { volume: null }),
    point("2026-08-21", 100, { volume: 300 }),
  ]);

  assert.equal(stats?.averageVolume, 200);
});

test("reports no average volume when the series carries none", () => {
  const stats = selectPriceStatistics([point("2026-08-21", 100)]);

  assert.equal(stats?.averageVolume, null);
});

test("measures the window's change from its oldest close to its newest", () => {
  const stats = selectPriceStatistics([
    point("2026-08-21", 150),
    point("2025-08-21", 100),
  ]);

  assert.equal(stats?.yearChangePercentage, 50);
  assert.equal(stats?.lastClose, 150);
  assert.equal(stats?.lastCloseDate, "2026-08-21");
  assert.equal(stats?.sessions, 2);
});
