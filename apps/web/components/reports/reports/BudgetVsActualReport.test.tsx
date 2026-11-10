// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { BudgetVsActualRow, ReportResponse } from "@/lib/api/reports/types";

import commonMessages from "../../../messages/en/common.json";
import reportsMessages from "../../../messages/en/reports.json";
import { BudgetVsActualReport } from "./BudgetVsActualReport";

const state = vi.hoisted(() => ({
  response: undefined as ReportResponse<BudgetVsActualRow[]> | undefined,
}));

vi.mock("@/lib/api/reports/budgetVsActual", () => ({
  default: () => ({
    data: state.response,
    error: null,
    isLoading: false,
    refetch: () => {},
  }),
  getBudgetVsActual: vi.fn(),
}));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [{}] } }),
}));
vi.mock("@/lib/api/category/useCategories", () => ({
  default: () => ({ data: { categories: [] } }),
}));
vi.mock("@/components/reports/filters/useReportFilters", () => ({
  useReportFilters: () => ({
    filters: {
      fromDate: "2026-07-01T00:00:00.000Z",
      toDate: "2026-07-31T23:59:59.000Z",
    },
  }),
}));
// The viewer keeps dollars; the household's budget is in euros.
vi.mock("@/components/reports/ReportsCurrencyContext", () => ({
  useReportsCurrency: () => ({ currencyKey: "USD", locale: "en" }),
}));

const messages = { ...commonMessages, ...reportsMessages };

const food: BudgetVsActualRow = {
  actual: 140,
  budgeted: 500,
  categoryKey: "10",
  color: "#f3f3f3",
  name: "Food",
  percentUsed: 28,
  variance: 360,
};

function respond(unconvertedTransactions: number): ReportResponse<BudgetVsActualRow[]> {
  return {
    completeness: {
      currencyCode: "EUR",
      isComplete: unconvertedTransactions === 0,
      unconvertedCurrencies: unconvertedTransactions > 0 ? ["USD"] : [],
      unconvertedTransactions,
    },
    data: [food],
    filters: {},
    generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function renderReport() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BudgetVsActualReport />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.response = undefined;
});

test("amounts are shown in the budget's currency, which the report names", () => {
  state.response = respond(0);

  renderReport();

  const report = screen.getByTestId("budget-vs-actual-report");
  const text = report.textContent ?? "";
  assert.match(text, /€500/);
  assert.doesNotMatch(text, /\$/);
});

test("the report says which amounts it leaves out", () => {
  state.response = respond(2);

  renderReport();

  const report = screen.getByTestId("budget-vs-actual-report");
  assert.match(within(report).getByRole("note").textContent ?? "", /USD/);
});

test("a complete report shows no note", () => {
  state.response = respond(0);

  renderReport();

  assert.equal(screen.queryByRole("note"), null);
});
