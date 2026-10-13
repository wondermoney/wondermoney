import assert from "node:assert/strict";

import { test } from "vitest";

import { getDefaultPortfolioCurrencyId } from "../PortfolioCreateDialog.helpers";

test("defaults to user's currency when available", () => {
  assert.equal(
    getDefaultPortfolioCurrencyId(
      [
        { code: "EUR", currencyKey: 1 },
        { code: "USD", currencyKey: 2 },
      ],
      "USD",
    ),
    "2",
  );
});

test("defaults to EUR when no user currency is available", () => {
  assert.equal(
    getDefaultPortfolioCurrencyId([
      { code: "EUR", currencyKey: 1 },
      { code: "USD", currencyKey: 2 },
    ]),
    "1",
  );
});
