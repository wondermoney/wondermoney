import assert from "node:assert/strict";

import { test } from "vitest";

import { buildConfirmTransactionOcrPayload } from "../useConfirmTransactionOcr";
import { OCR_UPLOAD_MAX_BYTES } from "../useCreateTransactionOcr";

test("serializes OCR confirmation amounts for the API string contract", () => {
  const payload = buildConfirmTransactionOcrPayload({
    accountId: "12",
    exchangeRate: 1.23456789,
    originalAmount: 123.45,
    settlementAmount: 152.4074060205,
    settlementCurrencyId: "151",
    transactionDate: new Date("2026-07-21T10:00:00.000Z"),
    transactionMerchantName: "Merchant",
    transactionTypeId: "1",
  });

  assert.equal(payload.exchangeRate, "1.23456789");
  assert.equal(payload.originalAmount, "123.45");
  assert.equal(payload.settlementAmount, "152.4074060205");
});

test("preserves already-stringified amount precision", () => {
  const payload = buildConfirmTransactionOcrPayload({
    accountId: "12",
    originalAmount: "0.12345678901234567890",
    settlementAmount: "0.12345678901234567890",
    settlementCurrencyId: "151",
    transactionDate: new Date("2026-07-21T10:00:00.000Z"),
    transactionMerchantName: "Merchant",
    transactionTypeId: "1",
  });

  assert.equal(payload.originalAmount, "0.12345678901234567890");
  assert.equal(payload.settlementAmount, "0.12345678901234567890");
});

test("uses the API's exact OCR upload byte limit", () => {
  assert.equal(OCR_UPLOAD_MAX_BYTES, 5_000_000);
});
