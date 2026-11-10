import assert from "node:assert/strict";

import { test } from "vitest";

import {
  accountFxView,
  exchangeRateSettingsHref,
  formatRateDate,
  transactionFxView,
} from "./fx-status";

const row = (fields: {
  fxStatus?: "exact" | "missing" | "provisional" | null;
  fxRateDate?: string | null;
  appuserSettlementAmount: number | null;
  from?: string;
}) => ({
  ...fields,
  settlementCurrencyKey: { code: fields.from ?? "JPY" },
  appuserCurrencyKey: { code: "EUR" },
});

test("a row converted at a current rate, or in the user's currency, is exact", () => {
  assert.deepEqual(
    transactionFxView(row({ fxStatus: "exact", appuserSettlementAmount: -60 })),
    { status: "exact" },
  );
  assert.deepEqual(
    transactionFxView(
      row({ fxStatus: null, appuserSettlementAmount: -25, from: "EUR" }),
    ),
    { status: "exact" },
  );
});

test("a row with no rate is missing, with or without a stored status", () => {
  assert.deepEqual(
    transactionFxView(
      row({ fxStatus: "missing", appuserSettlementAmount: null }),
    ),
    { status: "missing" },
  );
  // Written before the API stored a status: no converted amount, so not converted.
  assert.deepEqual(transactionFxView(row({ appuserSettlementAmount: null })), {
    status: "missing",
  });
});

test("a row converted at an old rate is provisional, with the rate's date", () => {
  assert.deepEqual(
    transactionFxView(
      row({
        fxStatus: "provisional",
        fxRateDate: "2026-10-01",
        appuserSettlementAmount: -60,
      }),
    ),
    { status: "provisional", rateDate: "2026-10-01" },
  );
});

test("an account balance converts from the account's currency to its owner's", () => {
  assert.deepEqual(
    accountFxView({
      appuserCurrencyBalance: null,
      currencyKey: { code: "JPY" },
      accountOwnerAppuserKey: { currencyKey: { code: "EUR" } },
    }),
    { status: "missing" },
  );
  assert.deepEqual(
    accountFxView({
      fxStatus: "missing",
      appuserCurrencyBalance: null,
      currencyKey: { code: "EUR" },
      accountOwnerAppuserKey: { currencyKey: { code: "EUR" } },
    }),
    { status: "exact" },
  );
});

test("the exchange rate link opens the Currencies settings, prefilled", () => {
  assert.equal(exchangeRateSettingsHref(), "/settings?tab=currencies");
  assert.equal(
    exchangeRateSettingsHref({ from: "JPY", date: "2026-10-01" }),
    "/settings?tab=currencies&from=JPY&date=2026-10-01",
  );
});

test("a rate date reads in the user's language, on its own calendar day", () => {
  assert.equal(formatRateDate("2026-10-01", "en-GB"), "1 Oct 2026");
  assert.equal(formatRateDate("not a date", "en"), "not a date");
});
