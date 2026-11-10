// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { ReportResponse, SpendingByCategoryRow } from "@/lib/api/reports/types";

import commonMessages from "../../../messages/en/common.json";
import reportsMessages from "../../../messages/en/reports.json";
import { SpendingByCategoryReport } from "./SpendingByCategoryReport";

const state = vi.hoisted(() => ({
  response: undefined as ReportResponse<SpendingByCategoryRow[]> | undefined,
}));

vi.mock("@/lib/api/reports/spendingByCategory", () => ({
  default: () => ({
    data: state.response,
    error: null,
    isPending: false,
    refetch: () => {},
  }),
  getSpendingByCategory: vi.fn(),
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
vi.mock("@/components/reports/ReportsCurrencyContext", () => ({
  useReportsCurrency: () => ({ currencyKey: "EUR", locale: "en" }),
}));
// The chart itself is not under test, and Recharts needs layout jsdom lacks.
vi.mock("@/components/ui/charts", () => ({ BarChartBase: () => null }));

const messages = { ...commonMessages, ...reportsMessages };

const groceries: SpendingByCategoryRow = {
  categoryKey: "10",
  color: "#f3f3f3",
  name: "Groceries",
  parentKey: null,
  percentOfTotal: 100,
  totalAmount: 276,
  transactionCount: 2,
};

function respond(
  data: SpendingByCategoryRow[],
  unconvertedTransactions: number,
): ReportResponse<SpendingByCategoryRow[]> {
  return {
    completeness: {
      currencyCode: "EUR",
      isComplete: unconvertedTransactions === 0,
      unconvertedTransactions,
    },
    data,
    filters: {},
    generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function renderReport() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SpendingByCategoryReport />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.response = undefined;
});

test("the report says how many expenses its totals leave out", () => {
  state.response = respond([groceries], 1);

  renderReport();

  const report = screen.getByTestId("spending-by-category-report");
  assert.match(
    within(report).getByRole("note").textContent ?? "",
    /1 transaction is left out/,
  );
});

test("the note shows even when every expense was left out", () => {
  state.response = respond([], 3);

  renderReport();

  assert.match(
    screen.getByRole("note").textContent ?? "",
    /3 transactions are left out/,
  );
});

test("a complete report shows no note", () => {
  state.response = respond([groceries], 0);

  renderReport();

  assert.equal(screen.queryByRole("note"), null);
});
