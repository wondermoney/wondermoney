// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { GetAccountsCashflowResponse } from "@/lib/api/account/useAccountsCashflow";

import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import { CashflowSection } from "./CashflowSection";

const state = vi.hoisted(() => ({
  response: { cashflow: [] } as GetAccountsCashflowResponse,
}));

vi.mock("@/lib/api/account/useAccountsCashflow", () => ({
  default: () => ({
    data: state.response,
    error: null,
    isPending: false,
    refetch: () => {},
  }),
}));
vi.mock("@/lib/api/net-worth/useNetWorth", () => ({
  default: () => ({ data: { netWorth: { currencyCode: "EUR" } } }),
}));

const messages = { ...commonMessages, ...homeMessages };

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CashflowSection />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.response = { cashflow: [] };
});

const thisMonth = () => {
  const today = new Date();
  return new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), 1),
  ).toISOString();
};

test("the cash flow says when rows with no exchange rate are left out", () => {
  state.response = {
    cashflow: [{ amount: -50, date: thisMonth() }],
    completeness: {
      currencyCode: "EUR",
      isComplete: false,
      unconvertedCurrencies: ["USD"],
      unconvertedTransactions: 1,
    },
  };

  renderSection();

  const section = screen.getByRole("region", {
    name: "Net cash flow by month",
  });
  assert.match(
    within(section).getByRole("note").textContent ?? "",
    /1 transaction in USD is left out/,
  );
});

test("a complete cash flow shows no notice", () => {
  state.response = {
    cashflow: [{ amount: -50, date: thisMonth() }],
    completeness: {
      currencyCode: "EUR",
      isComplete: true,
      unconvertedCurrencies: [],
      unconvertedTransactions: 0,
    },
  };

  renderSection();

  assert.equal(screen.queryByRole("note"), null);
});
