import assert from "node:assert/strict";

import { test } from "vitest";

import { dayBreaks, distinctMerchant, monthBreaks } from "./ledger";

test("a month break falls on the first row of each month, newest first", () => {
  const dates = [
    new Date(2026, 10, 2),
    new Date(2026, 10, 1),
    new Date(2026, 9, 30),
    new Date(2026, 9, 3),
    new Date(2025, 9, 30),
  ];

  assert.deepEqual(monthBreaks(dates), [true, false, true, false, true]);
});

test("a day break falls on the first row of each day, so a day's rows share one date", () => {
  const dates = [
    new Date(2026, 10, 3, 18),
    new Date(2026, 10, 3, 9),
    new Date(2026, 10, 2, 12),
    new Date(2026, 10, 2, 8),
    new Date(2026, 10, 1),
  ];

  assert.deepEqual(dayBreaks(dates), [true, false, true, false, true]);
});

test("the merchant is shown only when it adds to the description", () => {
  assert.equal(
    distinctMerchant({
      description: "Spotify",
      transactionMerchantKey: { name: "spotify " },
    }),
    null,
  );
  assert.equal(
    distinctMerchant({
      description: "Trf Mb Way para Joana",
      transactionMerchantKey: { name: "Mb Way Joana" },
    }),
    "Mb Way Joana",
  );
  assert.equal(distinctMerchant({ description: "Initial balance" }), null);
});
