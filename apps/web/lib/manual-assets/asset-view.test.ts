import assert from "node:assert/strict";

import { test } from "vitest";

import {
  calendarDay,
  changeSincePurchase,
  chartPoints,
  dayString,
  isEstimated,
  splitAssets,
} from "./asset-view";

test("a calendar day survives the round trip without shifting", () => {
  assert.equal(dayString(calendarDay("2026-03-01")), "2026-03-01");
  assert.equal(calendarDay("2026-03-01").getDate(), 1);
  assert.equal(dayString(undefined), "");
});

test("active assets come first by name, archived ones apart", () => {
  const { active, archived } = splitAssets([
    { archived: false, name: "home" },
    { archived: true, name: "Old car" },
    { archived: false, name: "Car" },
  ]);
  assert.deepEqual(
    active.map((asset) => asset.name),
    ["Car", "home"],
  );
  assert.deepEqual(
    archived.map((asset) => asset.name),
    ["Old car"],
  );
});

test("change since purchase is today's value less the purchase price", () => {
  assert.deepEqual(
    changeSincePurchase({ purchasePrice: 200_000, value: 250_000 }),
    { amount: 50_000, percent: 0.25 },
  );
  assert.deepEqual(
    changeSincePurchase({ purchasePrice: 20_000, value: 15_000 }),
    {
      amount: -5000,
      percent: -0.25,
    },
  );
});

test("change since purchase needs both figures, and no ratio over zero", () => {
  assert.equal(changeSincePurchase({ purchasePrice: null, value: 1 }), null);
  assert.equal(changeSincePurchase({ purchasePrice: 1, value: null }), null);
  assert.deepEqual(changeSincePurchase({ purchasePrice: 0, value: 10 }), {
    amount: 10,
    percent: null,
  });
});

test("a value is estimated only when a growth rule has moved it", () => {
  const lastValuation = {
    date: "2026-01-01",
    manualAssetValuationKey: 1,
    note: null,
    value: 100,
  };
  const growthRule = { annualRatePercent: 5, startDate: null };
  assert.equal(isEstimated({ growthRule, lastValuation, value: 105 }), true);
  assert.equal(isEstimated({ growthRule, lastValuation, value: 100 }), false);
  assert.equal(
    isEstimated({ growthRule: null, lastValuation, value: 100 }),
    false,
  );
  assert.equal(isEstimated({ growthRule, lastValuation, value: null }), false);
});

test("a stepped chart holds the old value until the day before a change", () => {
  const history = [
    { date: "2026-01-10", value: 200_000 },
    { date: "2026-06-01", value: 230_000 },
    { date: "2026-08-20", value: 230_000 },
  ];
  assert.deepEqual(chartPoints(history, { stepped: true }), [
    { date: "2026-01-10", value: 200_000 },
    { date: "2026-05-31", value: 200_000 },
    { date: "2026-06-01", value: 230_000 },
    { date: "2026-08-20", value: 230_000 },
  ]);
});

test("a stepped chart adds nothing between consecutive days", () => {
  const history = [
    { date: "2026-01-10", value: 1 },
    { date: "2026-01-11", value: 2 },
  ];
  assert.deepEqual(chartPoints(history, { stepped: true }), history);
});

test("a growing value is drawn as it comes", () => {
  const history = [
    { date: "2026-01-10", value: 100 },
    { date: "2026-01-31", value: 101 },
  ];
  assert.deepEqual(chartPoints(history, { stepped: false }), history);
});
