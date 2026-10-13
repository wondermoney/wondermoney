import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createNewMerchantSelection,
  normalizeTransactionMerchantName,
} from "./transaction-merchant";

test("normalizes new transaction merchant names", () => {
  assert.equal(normalizeTransactionMerchantName("  Continente  "), "Continente");
});

test("does not create a new merchant selection for a blank name", () => {
  assert.equal(createNewMerchantSelection("   "), null);
});

test("creates a prefixed merchant selection from the trimmed name", () => {
  assert.deepEqual(createNewMerchantSelection("  Continente  "), {
    id: "[NewMerchant]-Continente",
    name: "Continente",
  });
});
