import assert from "node:assert/strict";

import { test } from "vitest";

import {
  getPortfolioCreateInvalidationKeys,
  getPortfolioMutationsNetWorthInvalidationKeys,
  getPortfolioTransactionMutationInvalidationKeys,
} from "../portfolioInvalidation";

test("portfolio creation invalidates aggregate dashboard data", () => {
  assert.deepEqual(getPortfolioCreateInvalidationKeys(), [
    ["portfolios"],
    ["portfolio-dashboard"],
  ]);
});

test("portfolio mutations that affect net worth include the net-worth cache", () => {
  assert.ok(
    getPortfolioMutationsNetWorthInvalidationKeys().some(
      (queryKey) => Array.isArray(queryKey) && queryKey[0] === "net-worth",
    ),
  );
});

test("portfolio transaction mutations invalidate portfolio detail and net-worth caches", () => {
  assert.deepEqual(getPortfolioTransactionMutationInvalidationKeys(42), [
    ["portfolio-dashboard"],
    ["portfolio-performance"],
    ["portfolio-top-movers"],
    ["portfolio-allocation"],
    ["portfolio-holdings"],
    ["portfolios-holdings"],
    ["portfolio-metrics"],
    ["portfolio-transactions"],
    ["portfolios-transactions"],
    ["portfolio-dashboard", 42],
    ["portfolio-performance", 42],
    ["portfolio-top-movers", 42],
    ["portfolio-allocation", 42],
    ["portfolio-holdings", 42],
    ["portfolio-transactions", { portfolioId: 42 }],
    ["portfolios-transactions", { portfolioId: 42 }],
    ["portfolio-history-status"],
    ["portfolio"],
    ["net-worth"],
  ]);
});
