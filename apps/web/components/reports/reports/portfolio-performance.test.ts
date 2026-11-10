import assert from "node:assert/strict";

import { test } from "vitest";

import type { PortfolioPerformanceRow } from "@/lib/api/reports/types";

import {
  portfolioPerformanceFilters,
  sortByAbsoluteChangeDesc,
  totalPortfolioPerformance,
} from "./portfolio-performance";

const row = (
  overrides: Partial<PortfolioPerformanceRow> = {},
): PortfolioPerformanceRow => ({
  portfolioKey: "7",
  name: "Long-term",
  currency: "EUR",
  startValue: 1000,
  netContributions: 0,
  change: 0,
  changePercent: 0,
  dividends: 0,
  endValue: 1000,
  ...overrides,
});

test("totals the household and recomputes the percentage from the totals", () => {
  const totals = totalPortfolioPerformance([
    row({ startValue: 1000, netContributions: 0.1, change: 100.2, dividends: 1, endValue: 1100.3 }),
    row({ portfolioKey: "8", startValue: 0, netContributions: 0.2, change: -0.1, dividends: 2, endValue: 0.1 }),
  ]);

  assert.deepEqual(totals, {
    startValue: 1000,
    netContributions: 0.3,
    change: 100.1,
    changePercent: 10.01,
    dividends: 3,
    endValue: 1100.4,
  });
});

test("leaves a total unknown when any portfolio's figure is unknown", () => {
  const totals = totalPortfolioPerformance([
    row(),
    row({ portfolioKey: "8", startValue: null, change: null, changePercent: null }),
  ]);

  assert.equal(totals.startValue, null);
  assert.equal(totals.change, null);
  assert.equal(totals.changePercent, null);
  assert.equal(totals.endValue, 2000);
});

test("leaves contributions, dividends and the percentage unknown when a portfolio's trades could not be converted", () => {
  const totals = totalPortfolioPerformance([
    row({ netContributions: 100, dividends: 5 }),
    row({ portfolioKey: "8", netContributions: null, change: null, changePercent: null, dividends: null }),
  ]);

  assert.equal(totals.netContributions, null);
  assert.equal(totals.dividends, null);
  assert.equal(totals.change, null);
  assert.equal(totals.changePercent, null);
  assert.equal(totals.startValue, 2000);
});

test("lists the biggest movers first and unknown changes last", () => {
  const rows = [
    row({ portfolioKey: "a", change: 5 }),
    row({ portfolioKey: "b", change: null }),
    row({ portfolioKey: "c", change: -200 }),
  ].sort(sortByAbsoluteChangeDesc);

  assert.deepEqual(
    rows.map((r) => r.portfolioKey),
    ["c", "a", "b"],
  );
});

test("sends only the period: account and transaction filters don't apply to portfolios", () => {
  assert.deepEqual(
    portfolioPerformanceFilters({
      fromDate: "2026-08-01T00:00:00.000Z",
      toDate: "2026-10-31T23:59:59.999Z",
      timezone: "Europe/Lisbon",
      accountKeys: ["5"],
      includePending: true,
    }),
    {
      fromDate: "2026-08-01T00:00:00.000Z",
      toDate: "2026-10-31T23:59:59.999Z",
      timezone: "Europe/Lisbon",
    },
  );
});
