// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import commonMessages from "../../messages/en/common.json";
import TransactionsList from "./TransactionsList";

afterEach(cleanup);

const transaction = (fields: Partial<Transaction>): Transaction =>
  ({
    transactionKey: 1,
    transactionDate: "2026-11-02T10:00:00.000Z",
    accountKey: {
      accountKey: 1,
      accountName: "Yen card",
      currencyKey: { code: "JPY" },
    },
    settlementAmount: -10000,
    settlementCurrencyKey: { code: "JPY" },
    appuserSettlementAmount: null,
    appuserCurrencyKey: { code: "EUR" },
    balance: 0,
    appuserCurrencyBalance: 0,
    appuserTransactionCategories: [],
    description: "Tokyo hotel",
    descriptionDirty: "Tokyo hotel",
    reviewed: true,
    hidden: false,
    fxStatus: "missing",
    ...fields,
  }) as Transaction;

test("a recent transaction with no rate shows its original amount, not one labelled in the user's currency", () => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <TransactionsList transactions={[transaction({})]} />
    </NextIntlClientProvider>,
  );

  const text = container.textContent ?? "";
  assert.match(text, /¥10,000/);
  assert.doesNotMatch(text, /€/);
  assert.ok(screen.getByRole("button", { name: /^Not converted\./ }));
});

test("a row with a merchant leads with its avatar; a row without keeps the category tile", () => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <TransactionsList
        transactions={[
          transaction({
            transactionKey: 1,
            transactionMerchantKey: {
              transactionMerchantKey: 9,
              name: "Starbucks",
              website: null,
              logoUrl: null,
              resolvedLogoUrl: null,
            },
          }),
          transaction({ transactionKey: 2 }),
        ]}
      />
    </NextIntlClientProvider>,
  );

  const avatars = container.querySelectorAll("[data-merchant-avatar]");
  assert.equal(avatars.length, 1);
  assert.equal(avatars[0].textContent, "S");
  assert.match(container.textContent ?? "", /Starbucks/);
  assert.match(container.textContent ?? "", /Tokyo hotel/);
});
