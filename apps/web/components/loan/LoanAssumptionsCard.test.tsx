// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import type { LoanDetail } from "@/lib/api/loan/types";
import { figure } from "@/lib/manual-assets/asset-fixture";

import enCommon from "../../messages/en/common.json";
import enLoans from "../../messages/en/loans.json";
import LoanAssumptionsCard from "./LoanAssumptionsCard";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

const m = enLoans.loans;

const loan: LoanDetail = {
  currency: { code: "EUR", currencyKey: 1 },
  includeInNetWorth: true,
  loanKey: 5,
  name: "Home loan",
  openingPrincipalBalance: 200_000,
  outstandingPrincipal: 180_000,
  securedAsset: null,
  status: "ACTIVE",
  type: "MORTGAGE",
};

function renderCard(overrides: Partial<LoanDetail> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enLoans }}>
      <LoanAssumptionsCard loan={{ ...loan, ...overrides }} />
    </NextIntlClientProvider>,
  );
}

test("a secured loan links to its asset and shows what that is worth, in the asset's currency", () => {
  renderCard({
    securedAsset: {
      key: 7,
      name: "Lisbon flat",
      currency: "USD",
      value: 300_000,
    },
  });

  screen.getByText(m.fields.securedAsset);
  const link = screen.getByRole("link", { name: "Lisbon flat" });
  assert.equal(link.getAttribute("href"), "/assets/7");
  screen.getByText(figure("$300,000.00"));
});

test("an archived asset is still linked, with no value made up for today", () => {
  renderCard({
    securedAsset: { key: 9, name: "Sold flat", currency: "EUR", value: null },
  });

  screen.getByRole("link", { name: "Sold flat" });
  assert.equal(screen.queryByText(figure(/^€[\d,.]+$/)), null);
});

test("a loan secured against nothing has no asset row", () => {
  renderCard();

  assert.equal(screen.queryByText(m.fields.securedAsset), null);
  assert.equal(screen.queryByRole("link"), null);
});
