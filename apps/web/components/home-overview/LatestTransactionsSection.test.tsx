// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import type { TransactionReviewSummary } from "@/lib/api/account/useTransactionReviewSummary";
import type { Transaction } from "@/lib/api/account/useTransactions";
import {
  setStoredPrivacyMode,
  WithPrivacyMode,
} from "@/lib/privacy/privacy-test-utils";

import categoriesMessages from "../../messages/en/categories.json";
import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import { LatestTransactionsSection } from "./LatestTransactionsSection";

const state = vi.hoisted(() => ({
  summary: undefined as TransactionReviewSummary | undefined,
  transactions: [] as Transaction[],
}));

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
vi.mock("@/lib/api/account/useTransactionReviewSummary", () => ({
  default: () => ({ data: state.summary }),
}));

afterEach(() => {
  cleanup();
  setStoredPrivacyMode(false);
  state.summary = undefined;
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

function renderSection({ hidden = false }: { hidden?: boolean } = {}) {
  if (hidden) setStoredPrivacyMode(true);
  const section = (
    <NextIntlClientProvider
      locale="en"
      messages={{ ...commonMessages, ...homeMessages, ...categoriesMessages }}
    >
      <LatestTransactionsSection />
    </NextIntlClientProvider>
  );
  return render(
    hidden ? <WithPrivacyMode hidden>{section}</WithPrivacyMode> : section,
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

test("shows how many transactions await review, the amount at stake and the way in", () => {
  state.transactions = [transaction({})];
  state.summary = { count: 12, currency: "EUR", totalAbs: 1240 };

  renderSection();

  const summary = screen.getByText(/12 transactions to review/);
  assert.match(summary.textContent ?? "", /€1,240\.00 in total/);
  assert.equal(
    screen.getByRole("link", { name: "Review now" }).getAttribute("href"),
    "/accounts/transactions/review",
  );
});

test("says all caught up when nothing is waiting", () => {
  state.transactions = [transaction({})];
  state.summary = { count: 0, currency: "EUR", totalAbs: 0 };

  renderSection();

  assert.ok(screen.getByText("All caught up"));
  assert.equal(screen.queryByRole("link", { name: "Review now" }), null);
});

test("shows no review status at all for an account with no transactions", () => {
  state.transactions = [];
  state.summary = { count: 0, currency: "EUR", totalAbs: 0 };

  renderSection();

  assert.equal(screen.queryByText("All caught up"), null);
  assert.equal(screen.queryByRole("link", { name: "Review now" }), null);
});

test("shows no review status for an account with only an opening balance", () => {
  state.transactions = [
    transaction({ description: "Initial balance", transactionKey: -4 }),
  ];
  state.summary = { count: 0, currency: "EUR", totalAbs: 0 };

  renderSection();

  assert.equal(screen.queryByText("All caught up"), null);
});

test("masks the amount at stake in privacy mode, but not the count", () => {
  state.transactions = [transaction({})];
  state.summary = { count: 3, currency: "EUR", totalAbs: 1240 };

  renderSection({ hidden: true });

  const text = screen.getByText(/3 transactions to review/).textContent ?? "";
  assert.match(text, /3 transactions to review/);
  assert.ok(text.includes("•"), text);
  assert.ok(!text.includes("1,240"), text);
});
