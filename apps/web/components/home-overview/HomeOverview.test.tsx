// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/home.json";
import { HomeOverview } from "./HomeOverview";

const state = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
}));

vi.mock("@/lib/api/user-preferences/useUserPreferences", () => ({
  default: () => state.preferences,
}));
vi.mock("@/lib/utils/useHydrated", () => ({ useHydrated: () => true }));
vi.mock("./BankAlertsBanner", () => ({ BankAlertsBanner: () => null }));
vi.mock("./CustomizeHomeSheet", () => ({ CustomizeHomeSheet: () => null }));
vi.mock("@/components/dashboard/NetWorthViewedEvent", () => ({
  NetWorthViewedEvent: () => null,
}));
vi.mock("@/components/activation/SetupChecklistCard", () => ({
  SetupChecklistCard: () => null,
}));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [] }, isSuccess: true }),
}));
vi.mock("@/lib/api/account/useTransactions", () => ({
  default: () => ({ data: { transactions: [] } }),
}));
vi.mock("@/lib/api/budget/useBudgetsFull", () => ({
  default: () => ({ data: { budgets: [] } }),
}));
vi.mock("@/lib/api/net-worth/useNetWorth", () => ({
  default: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock("@/lib/api/portfolio/usePortfolios", () => ({
  default: () => ({ data: { portfolios: [] }, isSuccess: true }),
}));

vi.mock("./NetWorthHero", () => ({
  NetWorthHero: () => <div data-testid="section-net-worth">net-worth</div>,
}));
vi.mock("./InsightsSection", () => ({
  InsightsSection: () => <div data-testid="section-insights">insights</div>,
}));
vi.mock("./ThisMonthSection", () => ({
  ThisMonthSection: () => <div data-testid="section-this-month">this-month</div>,
}));
vi.mock("./BalanceSheetSection", () => ({
  BalanceSheetSection: () => (
    <div data-testid="section-balance-sheet">balance-sheet</div>
  ),
}));
vi.mock("./CashflowSection", () => ({
  CashflowSection: () => <div data-testid="section-cashflow">cashflow</div>,
}));
vi.mock("./LoansSection", () => ({
  LoansSection: () => <div data-testid="section-loans">loans</div>,
}));
vi.mock("./LatestTransactionsSection", () => ({
  LatestTransactionsSection: () => (
    <div data-testid="section-latest-transactions">latest-transactions</div>
  ),
}));

afterEach(cleanup);

function renderHome(dashboardLayout?: { id: string; hidden: boolean }[]) {
  state.preferences = {
    isPending: false,
    isError: false,
    data: { previewFeatures: false, dashboardLayout },
  };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeOverview />
    </NextIntlClientProvider>,
  );
}

const renderedSections = () =>
  Array.from(document.querySelectorAll('[data-testid^="section-"]')).map(
    (element) => element.getAttribute("data-testid")?.replace("section-", ""),
  );

test("renders the default order when nothing is saved", () => {
  renderHome();

  assert.deepEqual(renderedSections(), [
    "net-worth",
    "insights",
    "this-month",
    "balance-sheet",
    "cashflow",
    "loans",
    "latest-transactions",
  ]);
});

test("renders the saved order and skips hidden sections", () => {
  renderHome([
    { id: "net-worth", hidden: false },
    { id: "loans", hidden: false },
    { id: "this-month", hidden: true },
    { id: "latest-transactions", hidden: false },
    { id: "balance-sheet", hidden: true },
  ]);

  // The saved layout predates insights and cashflow, so they are appended, visible.
  assert.deepEqual(renderedSections(), [
    "net-worth",
    "loans",
    "latest-transactions",
    "insights",
    "cashflow",
  ]);
});

test("shows the customize affordance", () => {
  renderHome();

  assert.ok(screen.getByRole("button", { name: "Customize" }));
});
