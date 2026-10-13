import assert from "node:assert/strict";

import { test } from "vitest";

import { buildPayoffSeries } from "./payoff";

test("builds a decreasing balance series that reaches zero for a 0% debt", () => {
  const series = buildPayoffSeries({
    annualInterestRateBps: 0,
    balance: 1200,
    monthlyPayment: 100,
  });

  assert.equal(series[0]?.month, 0);
  assert.equal(series[0]?.balance, 1200);
  assert.equal(series.at(-1)?.balance, 0);
  assert.equal(series.at(-1)?.month, 12);
  // strictly decreasing balances
  for (let i = 1; i < series.length; i += 1) {
    assert.ok(series[i]!.balance < series[i - 1]!.balance);
  }
});

test("returns an empty series when the payment cannot cover the interest", () => {
  const series = buildPayoffSeries({
    annualInterestRateBps: 2400, // 24% APR => 20/mo interest on 1000
    balance: 1000,
    monthlyPayment: 15,
  });

  assert.deepEqual(series, []);
});

test("amortises an interest-bearing debt down to zero", () => {
  const series = buildPayoffSeries({
    annualInterestRateBps: 1200,
    balance: 1000,
    monthlyPayment: 100,
  });

  assert.ok(series.length > 1);
  assert.equal(series.at(-1)?.balance, 0);
});
