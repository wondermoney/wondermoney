import assert from "node:assert/strict";

import { test } from "vitest";

import type { HoldingPricePoint } from "@/lib/api/portfolio/useHoldingPriceOverrides";

import { getManualPriceDates, isIsoCalendarDate, parsePositivePrice, toHoldingPriceChartRows } from "./holding-price-utils";

const points: HoldingPricePoint[] = [
  { date: "2026-01-01", price: 10, source: "market" },
  { date: "2026-01-02", price: 12, source: "manual" },
  { date: "2026-01-03", price: 11, source: "market" },
];

test("accepts real calendar dates and rejects malformed or impossible dates", () => {
  assert.equal(isIsoCalendarDate("2026-02-28"), true);
  assert.equal(isIsoCalendarDate("2026-02-30"), false);
  assert.equal(isIsoCalendarDate("26-02-28"), false);
});

test("only accepts finite positive decimal prices", () => {
  assert.equal(parsePositivePrice("12.34"), 12.34);
  assert.equal(parsePositivePrice("0"), null);
  assert.equal(parsePositivePrice("-1"), null);
  assert.equal(parsePositivePrice("Infinity"), null);
  assert.equal(parsePositivePrice(""), null);
});

test("only days with a manual price of their own count as manual", () => {
  assert.deepEqual([...getManualPriceDates(points)], ["2026-01-02"]);
});

test("the chart's manual series carries a value on manual days only", () => {
  assert.deepEqual(toHoldingPriceChartRows(points), [
    { date: "2026-01-01", manual: null, price: 10 },
    { date: "2026-01-02", manual: 12, price: 12 },
    { date: "2026-01-03", manual: null, price: 11 },
  ]);
});
