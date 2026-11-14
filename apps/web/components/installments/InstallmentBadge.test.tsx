// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, test, vi } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import commonMessages from "../../messages/en/common.json";
import TransactionsList from "../account/TransactionsList";
import { InstallmentBadge } from "./InstallmentBadge";

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
  useRouter: () => ({ push: () => {} }),
}));

afterEach(cleanup);

const row = (fields: Partial<Transaction>): Transaction =>
  ({
    transactionKey: 1,
    transactionDate: "2026-11-02T10:00:00.000Z",
    accountKey: {
      accountKey: 3,
      accountName: "Visa",
      currencyKey: { code: "EUR" },
    },
    settlementAmount: -41.66,
    settlementCurrencyKey: { code: "EUR" },
    appuserSettlementAmount: -41.66,
    appuserCurrencyKey: { code: "EUR" },
    balance: 0,
    appuserCurrencyBalance: 0,
    appuserTransactionCategories: [],
    description: "Laptop store",
    descriptionDirty: "LAPTOP STORE 3/12",
    reviewed: true,
    hidden: false,
    fxStatus: "exact",
    ...fields,
  }) as Transaction;

function renderWithIntl(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("InstallmentBadge", () => {
  test("an installment row shows n/N, named for assistive tech and linking to its plan", () => {
    renderWithIntl(
      <InstallmentBadge
        installment={{
          installmentPlanKey: 9,
          installmentNumber: 3,
          installmentCount: 12,
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "Installment 3 of 12" });
    assert.equal(link.textContent, "3/12");
    assert.equal(link.getAttribute("href"), "/accounts/installment-plans/9");
  });

  test("an ordinary row shows nothing", () => {
    const { container } = renderWithIntl(
      <InstallmentBadge installment={null} />,
    );
    assert.equal(container.innerHTML, "");
  });

  test("a transaction list badges only the installment rows", () => {
    const { container } = renderWithIntl(
      <TransactionsList
        transactions={[
          row({
            transactionKey: 1,
            installment: {
              installmentPlanKey: 9,
              installmentNumber: 3,
              installmentCount: 12,
            },
          }),
          row({
            transactionKey: 2,
            description: "Groceries",
            installment: null,
          }),
          row({ transactionKey: 3, description: "Coffee" }),
        ]}
      />,
    );

    assert.equal(screen.getAllByRole("link").length, 1);
    assert.match(container.textContent ?? "", /Laptop store3\/12/);
    assert.doesNotMatch(container.textContent ?? "", /Groceries\d+\//);
  });
});
