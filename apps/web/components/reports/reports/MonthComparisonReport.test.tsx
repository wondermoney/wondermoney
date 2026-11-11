// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type {
  MonthComparisonData,
  ReportResponse,
} from "@/lib/api/reports/types";

import commonMessages from "../../../messages/en/common.json";
import reportsMessages from "../../../messages/en/reports.json";
import { monthKeyDateRange, monthKeyOf, shiftMonthKey } from "../filters/MonthPicker";
import { MonthComparisonReport } from "./MonthComparisonReport";

const state = vi.hoisted(() => ({
  response: undefined as ReportResponse<MonthComparisonData> | undefined,
}));

vi.mock("@/lib/api/reports/monthComparison", () => ({
  default: () => ({
    data: state.response,
    error: null,
    isPending: false,
    refetch: () => {},
  }),
  getMonthComparison: vi.fn(),
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

const THIS_MONTH = monthKeyOf(new Date());
const LAST_MONTH = shiftMonthKey(THIS_MONTH, -1);

const data: MonthComparisonData = {
  base: { expenses: 1150, income: 2020, month: THIS_MONTH, net: 870, savingsRate: 0.4307 },
  categories: [
    { base: 150, categoryKey: "10", color: "#f3f3f3", compare: 100, delta: 50, deltaPct: 50, name: "Groceries" },
    { base: 1000, categoryKey: "11", color: "#222222", compare: 900, delta: 100, deltaPct: 11.11, name: "Rent" },
  ],
  compare: { expenses: 1000, income: 2000, month: LAST_MONTH, net: 1000, savingsRate: 0.5 },
};

function respond(
  body: MonthComparisonData,
  unconvertedTransactions = 0,
): ReportResponse<MonthComparisonData> {
  return {
    completeness: {
      currencyCode: "EUR",
      isComplete: unconvertedTransactions === 0,
      unconvertedTransactions,
    },
    data: body,
    filters: {},
    generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function renderReport() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MonthComparisonReport />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.response = undefined;
});

test("the report offers two month pickers", () => {
  state.response = respond(data);

  renderReport();

  const report = screen.getByTestId("month-comparison-report");
  assert.ok(within(report).getByLabelText("Month"));
  assert.ok(within(report).getByLabelText("Compared with"));
});

test("the totals table shows both months and the change", () => {
  state.response = respond(data);

  renderReport();

  const report = screen.getByTestId("month-comparison-report");
  const rows = within(report).getAllByRole("row");
  const income = rows.find((row) => row.textContent?.startsWith("Income"));
  assert.ok(income);
  assert.match(income.textContent ?? "", /2,020\.00/);
  assert.match(income.textContent ?? "", /2,000\.00/);
  assert.match(income.textContent ?? "", /20\.00/);
});

test("each category links to that month's transactions", () => {
  state.response = respond(data);

  renderReport();

  const baseRange = monthKeyDateRange(THIS_MONTH);
  const report = screen.getByTestId("month-comparison-report");
  const groceries = within(report)
    .getAllByRole("row")
    .find((row) => row.textContent?.includes("Groceries"));
  assert.ok(groceries);
  const baseLink = within(groceries).getAllByRole("link")[0];
  assert.ok(baseLink);
  const url = new URL(baseLink.getAttribute("href") ?? "", "https://app.example");
  assert.match(url.pathname, /\/accounts\/transactions$/);
  assert.equal(url.searchParams.get("fromDate"), baseRange.fromDate);
  assert.equal(url.searchParams.get("toDate"), baseRange.toDate);
  assert.equal(url.searchParams.get("categoryKeys"), "10");
  assert.equal(url.searchParams.get("direction"), "out");
});

test("a category with no spending in the compare month has no percentage", () => {
  state.response = respond({
    ...data,
    categories: [
      { base: 40, categoryKey: "12", color: "#333333", compare: 0, delta: 40, deltaPct: null, name: "Travel" },
    ],
  });

  renderReport();

  const report = screen.getByTestId("month-comparison-report");
  const travel = within(report).getAllByRole("row").find((row) => row.textContent?.includes("Travel"));
  assert.ok(travel);
  assert.doesNotMatch(travel.textContent ?? "", /%/);
});

test("no spending in either month shows the empty state", () => {
  state.response = respond({
    base: { expenses: 0, income: 0, month: THIS_MONTH, net: 0, savingsRate: null },
    categories: [],
    compare: { expenses: 0, income: 0, month: LAST_MONTH, net: 0, savingsRate: null },
  });

  renderReport();

  assert.ok(screen.getByText("No spending in either month"));
});

test("the report says how many transactions its totals leave out", () => {
  state.response = respond(data, 2);

  renderReport();

  assert.match(screen.getByRole("note").textContent ?? "", /2 transactions are left out/);
});
