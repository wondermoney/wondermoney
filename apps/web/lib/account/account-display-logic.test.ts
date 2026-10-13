import assert from "node:assert/strict";

import { test } from "vitest";

import {
  getAccountChartCurrencyCode,
  getAccountsCashflowCurrencyCode,
} from "./account-display-logic";

test("account chart uses app-user currency code for normalized balances", () => {
  assert.equal(getAccountChartCurrencyCode("USD", "EUR"), "EUR");
});

test("accounts cashflow uses provided display currency code", () => {
  assert.equal(getAccountsCashflowCurrencyCode("EUR"), "EUR");
  assert.equal(getAccountsCashflowCurrencyCode("USD"), "USD");
});
