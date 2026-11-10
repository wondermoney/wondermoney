// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { CashflowPoint, ReportResponse } from "@/lib/api/reports/types";

import commonMessages from "../../../messages/en/common.json";
import reportsMessages from "../../../messages/en/reports.json";
import { CashflowReport } from "./CashflowReport";

const state = vi.hoisted(() => ({
  response: undefined as ReportResponse<CashflowPoint[]> | undefined,
}));

vi.mock("@/lib/api/reports/cashflow", () => ({
  default: () => ({
    data: state.response,
    error: null,
    isPending: false,
    refetch: () => {},
  }),
  getCashflow: vi.fn(),
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
vi.mock("@/components/ui/charts", () => ({
  ComposedAreaBarChartBase: () => null,
  useChartFormatters: () => ({ formatChartMonth: (month: string) => month }),
}));

const messages = { ...commonMessages, ...reportsMessages };

const july: CashflowPoint = {
  month: "2026-07",
  income: 1000,
  expenses: 400,
  net: 600,
};

function respond(
  data: CashflowPoint[],
  unconvertedTransactions: number,
): ReportResponse<CashflowPoint[]> {
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
      <CashflowReport />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.response = undefined;
});

test("the cash flow report says how many transactions its totals leave out", () => {
  state.response = respond([july], 2);

  renderReport();

  const report = screen.getByTestId("cashflow-report");
  assert.match(
    within(report).getByRole("note").textContent ?? "",
    /2 transactions are left out/,
  );
});

test("a complete cash flow report shows no note", () => {
  state.response = respond([july], 0);

  renderReport();

  assert.equal(screen.queryByRole("note"), null);
});
