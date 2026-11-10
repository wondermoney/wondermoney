// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import categoriesMessages from "../../messages/en/categories.json";
import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import { LatestTransactionsSection } from "./LatestTransactionsSection";

const state = vi.hoisted(() => ({ transactions: [] as Transaction[] }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/api/account/useTransactions", () => ({
  default: () => ({
    data: { transactions: state.transactions, total: 0 },
    error: null,
    isPending: false,
    refetch: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  state.transactions = [];
});

const transaction = (fields: Partial<Transaction>): Transaction =>
  ({
    transactionKey: 1,
    transactionDate: "2026-11-02T10:00:00.000Z",
    accountKey: {
      accountKey: 1,
      accountName: "Current",
      currencyKey: { code: "EUR" },
    },
    settlementAmount: -25,
    settlementCurrencyKey: { code: "EUR" },
    appuserSettlementAmount: -25,
    appuserCurrencyKey: { code: "EUR" },
    balance: 0,
    appuserCurrencyBalance: 0,
    appuserTransactionCategories: [],
    description: "Groceries",
    descriptionDirty: "Groceries",
    reviewed: true,
    hidden: false,
    fxStatus: "exact",
    ...fields,
  }) as Transaction;

function renderSection() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...commonMessages, ...homeMessages, ...categoriesMessages }}
    >
      <LatestTransactionsSection />
    </NextIntlClientProvider>,
  );
}

const rowOf = (description: string) =>
  screen.getByRole("rowheader", { name: new RegExp(description) })
    .parentElement!;

test("each latest transaction shows how it was converted", () => {
  state.transactions = [
    transaction({ transactionKey: 1, description: "Groceries" }),
    transaction({
      transactionKey: 2,
      description: "Tokyo hotel",
      settlementAmount: -10000,
      settlementCurrencyKey: { code: "JPY" as never },
      appuserSettlementAmount: null,
      fxStatus: "missing",
    }),
    transaction({
      transactionKey: 3,
      description: "New York taxi",
      settlementAmount: -40,
      settlementCurrencyKey: { code: "USD" },
      appuserSettlementAmount: -36,
      fxStatus: "provisional",
      fxRateDate: "2026-10-20",
    }),
  ];

  renderSection();

  const groceries = rowOf("Groceries");
  assert.match(groceries.textContent ?? "", /€25\.00/);
  assert.equal(within(groceries).queryByRole("button"), null);

  const hotel = rowOf("Tokyo hotel");
  assert.match(hotel.textContent ?? "", /¥10,000/);
  assert.ok(within(hotel).getByRole("button", { name: /^Not converted\./ }));

  const taxi = rowOf("New York taxi");
  assert.match(taxi.textContent ?? "", /€36\.00/);
  assert.match(
    within(taxi)
      .getByRole("button", { name: /^Estimated\./ })
      .getAttribute("aria-label") ?? "",
    /Oct 20, 2026/,
  );
});
