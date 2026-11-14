import assert from "node:assert/strict";

import { describe, test } from "vitest";

import type {
  LinkedTransaction,
  ReimbursementLink,
} from "@/lib/api/account/useTransactionReimbursements";
import type { Transaction } from "@/lib/api/account/useTransactions";

import {
  defaultLinkUnits,
  linkedTransactionTitle,
  otherSideOf,
  reimbursementBadgeKind,
  reimbursementErrorKey,
  reimbursementRoleOf,
} from "./transaction-reimbursement";

const side = (
  transactionKey: number,
  settlementAmount: number,
): LinkedTransaction => ({
  transactionKey,
  accountKey: 1,
  accountName: "Current",
  description: `Transaction ${transactionKey}`,
  merchantName: null,
  transactionDate: "2026-10-01T00:00:00.000Z",
  settlementAmount,
  currencyCode: "EUR",
});

const link = (
  key: number,
  amount: number,
  expense = side(1, -50),
  reimbursement = side(2, 20),
): ReimbursementLink => ({
  transactionReimbursementKey: key,
  amount,
  currencyCode: "EUR",
  createdAt: "2026-10-02T00:00:00.000Z",
  expense,
  reimbursement,
});

const row = (overrides: Partial<Transaction>): Transaction =>
  ({
    transactionKey: 1,
    settlementAmount: -50,
    reimbursements: [],
    ...overrides,
  }) as Transaction;

const apiError = (code: string) => ({ response: { data: { code } } });

describe("reimbursementRoleOf", () => {
  test("money in is a reimbursement and money out an expense, by the effective amount", () => {
    assert.equal(
      reimbursementRoleOf(row({ settlementAmount: 20 })),
      "reimbursement",
    );
    assert.equal(
      reimbursementRoleOf(row({ settlementAmount: -20 })),
      "expense",
    );
    assert.equal(
      reimbursementRoleOf(
        row({ settlementAmount: -20, editedSettlementAmount: 20 }),
      ),
      "reimbursement",
    );
  });

  test("a transfer, a loan repayment, a zero amount and a synthetic row cannot be linked", () => {
    assert.equal(
      reimbursementRoleOf(
        row({
          settlementAmount: 20,
          transactionTypeKey: { name: "TRANSFER_IN" },
        }),
      ),
      null,
    );
    assert.equal(
      reimbursementRoleOf(
        row({
          loanRepayment: {
            loanKey: 1,
            loanName: "Car",
            principalAmount: 40,
            interestAmount: 10,
            feeAmount: 0,
            spendingAmount: 0,
          },
        }),
      ),
      null,
    );
    assert.equal(reimbursementRoleOf(row({ settlementAmount: 0 })), null);
    assert.equal(reimbursementRoleOf(row({ transactionKey: -1 })), null);
  });
});

test("otherSideOf names the transaction at the far end of the link", () => {
  assert.equal(otherSideOf(link(9, 20), 1).transactionKey, 2);
  assert.equal(otherSideOf(link(9, 20), 2).transactionKey, 1);
});

test("linkedTransactionTitle prefers the merchant, then the description", () => {
  assert.equal(
    linkedTransactionTitle({ merchantName: "Shop", description: "SHOP 123" }),
    "Shop",
  );
  assert.equal(
    linkedTransactionTitle({ merchantName: " ", description: "SHOP 123" }),
    "SHOP 123",
  );
  assert.equal(
    linkedTransactionTitle({ merchantName: null, description: null }),
    null,
  );
});

describe("reimbursementBadgeKind", () => {
  test("no links, no badge", () => {
    assert.equal(reimbursementBadgeKind(row({})), null);
    assert.equal(
      reimbursementBadgeKind(row({ reimbursements: undefined })),
      null,
    );
  });

  test("an expense is partly reimbursed until its links cover its whole amount", () => {
    assert.equal(
      reimbursementBadgeKind(row({ reimbursements: [link(1, 20)] })),
      "partly-reimbursed",
    );
    assert.equal(
      reimbursementBadgeKind(
        row({
          reimbursements: [link(1, 20), link(2, 30, side(1, -50), side(3, 30))],
        }),
      ),
      "reimbursed",
    );
    // 0.1 + 0.2 links exactly cover 0.3, which a float sum would miss.
    assert.equal(
      reimbursementBadgeKind(
        row({
          settlementAmount: -0.3,
          reimbursements: [link(1, 0.1), link(2, 0.2)],
        }),
      ),
      "reimbursed",
    );
  });

  test("money in with links is a reimbursement", () => {
    assert.equal(
      reimbursementBadgeKind(
        row({
          transactionKey: 2,
          settlementAmount: 20,
          reimbursements: [link(1, 20)],
        }),
      ),
      "reimbursement",
    );
  });
});

test("defaultLinkUnits is what both sides still have free", () => {
  assert.equal(defaultLinkUnits(20, 50), 200000n);
  assert.equal(defaultLinkUnits(50, 20), 200000n);
  assert.equal(defaultLinkUnits(12.34, 12.34), 123400n);
  assert.equal(defaultLinkUnits(-1, 20), 0n);
});

test("reimbursementErrorKey maps every refusal in the contract", () => {
  assert.equal(reimbursementErrorKey(apiError("not_found")), "not-found");
  assert.equal(
    reimbursementErrorKey(apiError("reimbursement_currency_mismatch")),
    "currency-mismatch",
  );
  assert.equal(
    reimbursementErrorKey(apiError("reimbursement_amount_exceeded")),
    "amount-exceeded",
  );
  assert.equal(
    reimbursementErrorKey(apiError("reimbursement_visibility_mismatch")),
    "visibility-mismatch",
  );
  assert.equal(
    reimbursementErrorKey(apiError("reimbursement_invalid")),
    "invalid",
  );
  assert.equal(
    reimbursementErrorKey(apiError("reimbursement_link_exists")),
    "link-exists",
  );
  assert.equal(reimbursementErrorKey(apiError("internal_error")), null);
  assert.equal(reimbursementErrorKey(new Error("offline")), null);
});
