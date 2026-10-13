import assert from "node:assert/strict";

import { startOfMonth, subMonths } from "date-fns";
import { test } from "vitest";

import {
  getAccountsCashflowFromDate,
  getAccountsOverviewCurrencyCode,
} from "./accounts-overview-state";

test("accounts cashflow timeframe matches the selected overview timeframe", () => {
  const selectedFromDate = startOfMonth(subMonths(new Date(), 3));

  assert.deepEqual(getAccountsCashflowFromDate(selectedFromDate), selectedFromDate);
});

test("accounts overview currency uses explicit user currency when available", () => {
  assert.equal(getAccountsOverviewCurrencyCode("USD"), "USD");
  assert.equal(getAccountsOverviewCurrencyCode(undefined), "EUR");
});
