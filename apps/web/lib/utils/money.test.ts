import assert from "node:assert/strict";

import { test } from "vitest";

import { CurrencyMismatchError, sumMoney } from "./money";

test("sums amounts in one currency without float drift", () => {
  assert.equal(
    sumMoney(
      [
        { amount: 0.1, currency: "EUR" },
        { amount: 0.2, currency: "EUR" },
      ],
      "EUR",
    ),
    0.3,
  );
  assert.equal(sumMoney([], "USD"), 0);
});

test("refuses to add amounts in different currencies", () => {
  assert.throws(
    () =>
      sumMoney(
        [
          { amount: 10, currency: "EUR" },
          { amount: 10, currency: "USD" },
        ],
        "EUR",
      ),
    CurrencyMismatchError,
  );
  assert.throws(
    () => sumMoney([{ amount: 10, currency: "USD" }], "EUR"),
    CurrencyMismatchError,
  );
});

test("has no total when any amount is unknown", () => {
  assert.equal(
    sumMoney(
      [
        { amount: 10, currency: "EUR" },
        { amount: null, currency: "EUR" },
      ],
      "EUR",
    ),
    null,
  );
});
