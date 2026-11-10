// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { ReportResponse, SankeyData } from "@/lib/api/reports/types";

import commonMessages from "../../../messages/en/common.json";
import reportsMessages from "../../../messages/en/reports.json";
import { SankeyReport } from "./SankeyReport";

const state = vi.hoisted(() => ({
  response: undefined as ReportResponse<SankeyData> | undefined,
}));

vi.mock("@/lib/api/reports/sankey", () => ({
  default: () => ({
    data: state.response,
    error: null,
    isPending: false,
    refetch: () => {},
  }),
  getSankey: vi.fn(),
}));
vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({ data: { categories: [] } }),
}));
vi.mock("@/lib/api/account/useAccounts", () => ({
  default: () => ({ data: { accounts: [] } }),
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
// The chart itself is not under test, and its layout needs a real DOM.
vi.mock("@/components/reports/sankey/SankeyChart", () => ({
  SankeyChart: () => null,
}));

const messages = { ...commonMessages, ...reportsMessages };

const salaryToGroceries: SankeyData = {
  nodes: [
    { id: "income-1", label: "Salary", kind: "income" },
    { id: "expense-2", label: "Groceries", kind: "expense" },
  ],
  links: [{ source: "income-1", target: "expense-2", value: 120 }],
};

function respond(
  data: SankeyData,
  unconvertedTransactions: number,
): ReportResponse<SankeyData> {
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
      <SankeyReport />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.response = undefined;
});

test("the Sankey report says how many transactions its flows leave out", () => {
  state.response = respond(salaryToGroceries, 1);

  renderReport();

  const report = screen.getByTestId("sankey-report");
  assert.match(
    within(report).getByRole("note").textContent ?? "",
    /1 transaction is left out/,
  );
});

test("a complete Sankey report shows no note", () => {
  state.response = respond(salaryToGroceries, 0);

  renderReport();

  assert.equal(screen.queryByRole("note"), null);
});
