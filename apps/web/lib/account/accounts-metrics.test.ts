import assert from "node:assert/strict";

import { test } from "vitest";

import type { AccountMetrics } from "@/lib/api/account/useAccountsMetrics";

import { aggregateMetrics } from "./accounts-metrics";

function metric(overrides: Partial<AccountMetrics>): AccountMetrics {
  return {
    type: "inflow",
    accountKey: 1,
    accountName: "Current",
    currencyCode: "EUR",
    transactionType: "PAYMENT",
    inflowCurrentPeriod: 0,
    outflowCurrentPeriod: 0,
    transactionCountCurrentPeriod: 0,
    inflowPastPeriod: 0,
    outflowPastPeriod: 0,
    transactionCountPastPeriod: 0,
    inflowDelta: 0,
    inflowDeltaPercentage: 0,
    outflowDelta: 0,
    outflowDeltaPercentage: 0,
    transactionCountDelta: 0,
    transactionCountDeltaPercentage: 0,
    ...overrides,
  };
}

test("flows add up across accounts, this period and the last", () => {
  const agg = aggregateMetrics([
    metric({
      inflowCurrentPeriod: 2000,
      outflowCurrentPeriod: 300,
      inflowPastPeriod: 1800,
      outflowPastPeriod: 250,
    }),
    metric({
      accountKey: 2,
      inflowCurrentPeriod: 100,
      outflowCurrentPeriod: 50,
      inflowPastPeriod: 0,
      outflowPastPeriod: 50,
    }),
  ]);

  assert.equal(agg.inflowCurrent, 2100);
  assert.equal(agg.outflowCurrent, 350);
  assert.equal(agg.inflowPast, 1800);
  assert.equal(agg.outflowPast, 300);
});

test("the change is measured against last period's total", () => {
  const agg = aggregateMetrics([
    metric({
      inflowCurrentPeriod: 150,
      inflowPastPeriod: 100,
      outflowCurrentPeriod: 80,
      outflowPastPeriod: 100,
    }),
  ]);

  assert.equal(agg.inflowPct, 0.5);
  assert.equal(agg.outflowPct, -0.2);
});

test("from a zero baseline, any flow is an unbounded rise and none is no change", () => {
  const rising = aggregateMetrics([metric({ outflowCurrentPeriod: 182.91 })]);
  const flat = aggregateMetrics([metric({})]);

  assert.equal(rising.outflowPct, Infinity);
  assert.equal(rising.inflowPct, 0);
  assert.equal(flat.outflowPct, 0);
});
