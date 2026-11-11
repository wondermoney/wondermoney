import assert from "node:assert/strict";

import { describe, test } from "vitest";

import type { TransactionType } from "@/lib/api/account/useTransactionTypes";
import type { TransactionTemplate } from "@/lib/api/transaction-template/useTransactionTemplates";

import {
  transactionTemplatePrefill,
  transactionTypeForDirection,
} from "./transaction-template";

const types: TransactionType[] = [
  { name: "DEPOSIT", transactionTypeKey: 1 },
  { name: "CARD_PAYMENT", transactionTypeKey: 2 },
  { name: "PAYMENT", transactionTypeKey: 3 },
  { name: "TRANSFER_OUT", transactionTypeKey: 4 },
];

const template = (
  overrides: Partial<TransactionTemplate> = {},
): TransactionTemplate => ({
  account: null,
  amount: null,
  category: null,
  description: null,
  direction: "out",
  name: "Weekly groceries",
  notes: null,
  position: 0,
  transactionMerchant: null,
  transactionTemplateKey: 1,
  ...overrides,
});

describe("transactionTypeForDirection", () => {
  test("picks a type that moves money the way the template says", () => {
    assert.equal(transactionTypeForDirection(types, "out")?.name, "PAYMENT");
    assert.equal(transactionTypeForDirection(types, "in")?.name, "DEPOSIT");
  });

  test("returns nothing when the server offers no type for that direction", () => {
    assert.equal(
      transactionTypeForDirection(
        [{ name: "TRANSFER_OUT", transactionTypeKey: 4 }],
        "in",
      ),
      undefined,
    );
  });
});

describe("transactionTemplatePrefill", () => {
  test("fills every field the template carries", () => {
    const today = new Date("2026-11-11T09:00:00Z");

    const prefill = transactionTemplatePrefill(
      template({
        account: { accountKey: 7, accountName: "Wallet" },
        amount: 42.5,
        category: { categoryKey: 9, name: "Groceries" },
        description: "Saturday market",
        notes: "Cash",
        transactionMerchant: {
          name: "Corner shop",
          transactionMerchantKey: 12,
        },
      }),
      types,
      today,
    );

    assert.deepEqual(prefill, {
      accountId: "7",
      categoryId: "9",
      description: "Saturday market",
      notes: "Cash",
      settlementAmount: 42.5,
      transactionDate: today,
      transactionMerchantId: "12",
      transactionMerchantName: "Corner shop",
      transactionTypeId: "3",
    });
  });

  test("dates the entry today and leaves out what the template does not carry", () => {
    const today = new Date("2026-11-11T09:00:00Z");

    const prefill = transactionTemplatePrefill(
      template({ direction: "in" }),
      types,
      today,
    );

    assert.deepEqual(prefill, {
      description: "",
      notes: "",
      transactionDate: today,
      transactionMerchantName: "",
      transactionTypeId: "1",
    });
  });
});
