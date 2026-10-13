import assert from "node:assert/strict";

import { test } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import {
  getTransactionDisplayName,
  getTransactionReviewBuckets,
  groupTransactionsByMerchant,
} from "./transaction-review-groups";

function transaction(
  overrides: Partial<Transaction> & Pick<Transaction, "transactionKey">,
): Transaction {
  const { transactionKey, ...rest } = overrides;

  return {
    transactionKey,
    transactionDate: "2026-06-01T00:00:00.000Z",
    accountKey: {
      accountKey: 1,
      accountName: "Main account",
      currencyKey: { code: "EUR" },
    },
    settlementAmount: -12,
    settlementCurrencyKey: { code: "EUR" },
    appuserSettlementAmount: -12,
    appuserCurrencyKey: { code: "EUR" },
    balance: 100,
    appuserCurrencyBalance: 100,
    appuserTransactionCategories: [],
    transactionMerchantKey: undefined,
    description: "Fallback description",
    descriptionDirty: "Fallback description dirty",
    hidden: false,
    reviewed: false,
    ...rest,
  };
}

test("review buckets split unreviewed transactions by category presence", () => {
  const uncategorized = transaction({ transactionKey: 1 });
  const suggested = transaction({
    transactionKey: 2,
    appuserTransactionCategories: [
      {
        categoryKey: 9,
        name: "Groceries",
        isSystemCategory: true,
        bgColor: "#ffffff",
        textColor: "#000000",
      },
    ],
  });
  const alreadyReviewed = transaction({ transactionKey: 3, reviewed: true });

  const buckets = getTransactionReviewBuckets([
    uncategorized,
    suggested,
    alreadyReviewed,
  ]);

  assert.deepEqual(
    buckets.needsCategory.map((item) => item.transactionKey),
    [1],
  );
  assert.deepEqual(
    buckets.suggestedCategory.map((item) => item.transactionKey),
    [2],
  );
  assert.equal(buckets.totalUnreviewed, 2);
});

test("display name prefers merchant name over dirty description", () => {
  assert.equal(
    getTransactionDisplayName(
      transaction({
        transactionKey: 1,
        transactionMerchantKey: { name: "Continente" },
        descriptionDirty: "CONTINENTE 123",
      }),
    ),
    "Continente",
  );
});

test("display name falls back to dirty description and then description", () => {
  assert.equal(
    getTransactionDisplayName(
      transaction({ transactionKey: 1, descriptionDirty: "Dirty value" }),
    ),
    "Dirty value",
  );
  assert.equal(
    getTransactionDisplayName(
      transaction({
        transactionKey: 2,
        description: "Clean value",
        descriptionDirty: "",
      }),
    ),
    "Clean value",
  );
});

test("display name trims whitespace and falls back to the next candidate", () => {
  assert.equal(
    getTransactionDisplayName(
      transaction({
        transactionKey: 1,
        transactionMerchantKey: { name: "   " },
        descriptionDirty: " Dirty value ",
      }),
    ),
    "Dirty value",
  );
  assert.equal(
    getTransactionDisplayName(
      transaction({
        transactionKey: 2,
        transactionMerchantKey: { name: "   " },
        descriptionDirty: "   ",
        description: " Clean value ",
      }),
    ),
    "Clean value",
  );
});

test("display name falls back to transaction key when merchant and descriptions are missing", () => {
  assert.equal(
    getTransactionDisplayName(
      transaction({
        transactionKey: 42,
        transactionMerchantKey: undefined,
        descriptionDirty: "",
        description: "",
      }),
    ),
    "#42",
  );
});

test("merchant grouping keeps unknown merchants separate by description", () => {
  const groups = groupTransactionsByMerchant([
    transaction({
      transactionKey: 1,
      transactionMerchantKey: { name: "Spotify" },
      settlementAmount: -7.99,
    }),
    transaction({
      transactionKey: 2,
      transactionMerchantKey: { name: "Spotify" },
      settlementAmount: -7.99,
    }),
    transaction({
      transactionKey: 3,
      transactionMerchantKey: undefined,
      descriptionDirty: "UNKNOWN A",
      settlementAmount: -5,
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.label, "Spotify");
  assert.equal(groups[0]?.transactions.length, 2);
  assert.equal(groups[0]?.totalSettlementAmount, -15.98);
});

test("merchant grouping is case-insensitive and sorts larger groups first", () => {
  const groups = groupTransactionsByMerchant([
    transaction({
      transactionKey: 1,
      transactionMerchantKey: { name: "spotify" },
      settlementAmount: -7.99,
    }),
    transaction({
      transactionKey: 2,
      transactionMerchantKey: { name: "Spotify" },
      settlementAmount: -7.99,
    }),
    transaction({
      transactionKey: 3,
      transactionMerchantKey: { name: "Netflix" },
      settlementAmount: -12.99,
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.label, "spotify");
  assert.equal(groups[0]?.transactions.length, 2);
  assert.equal(groups[1]?.label, "Netflix");
  assert.equal(groups[1]?.transactions.length, 1);
});

test("merchant grouping splits the same merchant across settlement currencies", () => {
  const groups = groupTransactionsByMerchant([
    transaction({
      transactionKey: 1,
      transactionMerchantKey: { name: "Spotify" },
      settlementAmount: -7.99,
      settlementCurrencyKey: { code: "EUR" },
    }),
    transaction({
      transactionKey: 2,
      transactionMerchantKey: { name: "spotify" },
      settlementAmount: -9.99,
      settlementCurrencyKey: { code: "USD" },
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.settlementCurrencyCode),
    ["EUR", "USD"],
  );
  assert.deepEqual(
    groups.map((group) => group.totalSettlementAmount),
    [-7.99, -9.99],
  );
});

test("needs-category bucket orders low-confidence (ambiguous) before none/other", () => {
  const buckets = getTransactionReviewBuckets([
    transaction({ transactionKey: 1, categorizationConfidence: "none" }),
    transaction({ transactionKey: 2, categorizationConfidence: "low" }),
    transaction({ transactionKey: 3, categorizationConfidence: null }),
  ]);
  assert.deepEqual(
    buckets.needsCategory.map((entry) => entry.transactionKey),
    [2, 1, 3],
  );
});
