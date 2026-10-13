import assert from "node:assert/strict";

import { test } from "vitest";

import { getPortfolioFromDate } from "./portfolio-date-range";
import { shouldOpenPendingPortfolioImport } from "./portfolio-modal-transition";

test("portfolio 1M period starts one month ago", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");

  assert.equal(getPortfolioFromDate("1M", now), "2026-02-12");
});

test("portfolio 3M period starts three months ago", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");

  assert.equal(getPortfolioFromDate("3M", now), "2025-12-12");
});

test("portfolio YTD period starts at year start", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");

  assert.equal(getPortfolioFromDate("YTD", now), "2026-01-01");
});

test("portfolio ALL period has no from date", () => {
  const now = new Date("2026-03-12T10:15:00.000Z");

  assert.equal(getPortfolioFromDate("ALL", now), undefined);
});

test("portfolio import handoff waits until add transaction modal closes", () => {
  assert.equal(
    shouldOpenPendingPortfolioImport({
      isAddTransactionOpen: true,
      pendingImportOpen: true,
    }),
    false,
  );
  assert.equal(
    shouldOpenPendingPortfolioImport({
      isAddTransactionOpen: false,
      pendingImportOpen: true,
    }),
    true,
  );
});
