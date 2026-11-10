// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import type { NetWorth } from "@/lib/api/net-worth/useNetWorth";

import commonMessages from "../../messages/en/common.json";
import homeMessages from "../../messages/en/home.json";
import { BalanceSheetSection } from "./BalanceSheetSection";

const state = vi.hoisted(() => ({
  netWorth: { netWorth: 0, rows: [] } as NetWorth,
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
vi.mock("./PortfolioLinkSuggestion", () => ({
  PortfolioLinkSuggestion: () => null,
}));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [] } }),
}));
vi.mock("@/lib/api/net-worth/useNetWorth", () => ({
  default: () => ({
    data: { netWorth: state.netWorth },
    error: null,
    isPending: false,
    refetch: () => {},
  }),
}));

afterEach(cleanup);

function renderSheet(unconverted: NetWorth["unconverted"]) {
  state.netWorth = {
    netWorth: 1000,
    currencyCode: "EUR",
    rows: [{ key: "accounts:1", recordId: 1, label: "Current", amount: 1000 }],
    unconverted,
  };
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...commonMessages, ...homeMessages }}
    >
      <BalanceSheetSection />
    </NextIntlClientProvider>,
  );
}

test("the balance sheet says what it leaves out for want of an exchange rate", () => {
  renderSheet({ count: 2, currencies: ["JPY", "USD"] });

  const note = screen.getByRole("note");
  assert.match(
    note.textContent ?? "",
    /leaves out 2 accounts, loans or portfolios/,
  );
  assert.match(note.textContent ?? "", /JPY and USD/);
  assert.ok(screen.getByRole("link", { name: "Add an exchange rate" }));
});

test("a complete balance sheet has no note", () => {
  renderSheet({ count: 0, currencies: [] });

  assert.equal(screen.queryByRole("note"), null);
});
