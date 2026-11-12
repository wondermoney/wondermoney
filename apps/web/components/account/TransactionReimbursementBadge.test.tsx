// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type {
  LinkedTransaction,
  ReimbursementLink,
} from "@/lib/api/account/useTransactionReimbursements";
import type { Transaction } from "@/lib/api/account/useTransactions";

import enCommon from "../../messages/en/common.json";
import enTransactions from "../../messages/en/transactions.json";
import {
  TransactionReimbursementBadge,
  TransactionReimbursementLinksList,
} from "./TransactionReimbursementBadge";

afterEach(cleanup);

const side = (
  transactionKey: number,
  settlementAmount: number,
  merchantName: string,
): LinkedTransaction => ({
  transactionKey,
  accountKey: 1,
  accountName: "Current account",
  description: null,
  merchantName,
  transactionDate: "2026-10-01T00:00:00.000Z",
  settlementAmount,
  currencyCode: "EUR",
});

const shoes = side(1, -50, "Shoe shop");
const refund = side(2, 20, "Shoe shop refund");
const friend = side(3, 30, "Alex");

const link = (
  key: number,
  amount: number,
  reimbursement: LinkedTransaction,
): ReimbursementLink => ({
  transactionReimbursementKey: key,
  amount,
  currencyCode: "EUR",
  createdAt: "2026-10-02T00:00:00.000Z",
  expense: shoes,
  reimbursement,
});

const row = (overrides: Partial<Transaction>): Transaction =>
  ({
    transactionKey: 1,
    settlementAmount: -50,
    reimbursements: [],
    ...overrides,
  }) as Transaction;

function renderWithIntl(ui: React.ReactNode) {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enCommon, ...enTransactions }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

function renderBadge(transaction: Transaction) {
  const onOpenLinked = vi.fn();
  const onShowLinks = vi.fn();
  const onRowClick = vi.fn();
  renderWithIntl(
    // The row opens its inspector on click; the badge must not set that off too.
    <div onClick={onRowClick}>
      <TransactionReimbursementBadge
        transaction={transaction}
        onOpenLinked={onOpenLinked}
        onShowLinks={onShowLinks}
      />
    </div>,
  );
  return { onOpenLinked, onShowLinks, onRowClick };
}

test("a partly reimbursed expense opens its one reimbursement", async () => {
  const user = userEvent.setup();
  const { onOpenLinked, onShowLinks, onRowClick } = renderBadge(
    row({ reimbursements: [link(9, 20, refund)] }),
  );

  const badge = screen.getByRole("button", {
    name: "Partly reimbursed: open Shoe shop refund",
  });
  assert.equal(badge.textContent, "Partly reimbursed");
  await user.click(badge);

  assert.deepEqual(onOpenLinked.mock.calls, [[2]]);
  assert.equal(onShowLinks.mock.calls.length, 0);
  assert.equal(onRowClick.mock.calls.length, 0);
});

test("an expense whose links cover it is reimbursed, and several links show the list", async () => {
  const user = userEvent.setup();
  const { onOpenLinked, onShowLinks } = renderBadge(
    row({ reimbursements: [link(9, 20, refund), link(10, 30, friend)] }),
  );

  const badge = screen.getByRole("button", {
    name: "Reimbursed: show the 2 linked transactions",
  });
  assert.equal(badge.textContent, "Reimbursed");
  await user.click(badge);

  assert.equal(onShowLinks.mock.calls.length, 1);
  assert.equal(onOpenLinked.mock.calls.length, 0);
});

test("money in with a link is a reimbursement and opens the expense", async () => {
  const user = userEvent.setup();
  const { onOpenLinked } = renderBadge(
    row({
      transactionKey: 2,
      settlementAmount: 20,
      reimbursements: [link(9, 20, refund)],
    }),
  );

  await user.click(
    screen.getByRole("button", { name: "Reimbursement: open Shoe shop" }),
  );
  assert.deepEqual(onOpenLinked.mock.calls, [[1]]);
});

test("a row without links has no badge", () => {
  renderBadge(row({}));
  assert.equal(screen.queryByRole("button"), null);
});

test("the inspector list opens a linked transaction that is loaded, and only describes one that is not", async () => {
  const user = userEvent.setup();
  const onOpenLinked = vi.fn();
  renderWithIntl(
    <TransactionReimbursementLinksList
      transaction={row({
        reimbursements: [link(9, 20, refund), link(10, 30, friend)],
      })}
      canOpen={(transactionKey) => transactionKey === 2}
      onOpenLinked={onOpenLinked}
    />,
  );

  assert.ok(screen.getByText("Reimbursement links"));
  await user.click(
    screen.getByRole("button", { name: "Open Shoe shop refund" }),
  );
  assert.deepEqual(onOpenLinked.mock.calls, [[2]]);

  assert.ok(screen.getByText("Alex"));
  assert.equal(screen.queryByRole("button", { name: "Open Alex" }), null);
});
