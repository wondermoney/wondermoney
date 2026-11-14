// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type {
  PortfolioPerformanceRow,
  ReportResponse,
} from "@/lib/api/reports/types";

import commonMessages from "../../../messages/en/common.json";
import reportsMessages from "../../../messages/en/reports.json";
import { PortfolioPerformanceReport } from "./PortfolioPerformanceReport";

const state = vi.hoisted(() => ({
  rows: [] as PortfolioPerformanceRow[],
}));

vi.mock("@/lib/api/reports/portfolioPerformance", () => ({
  default: () => ({
    data: {
      completeness: { currencyCode: "EUR", isComplete: true },
      data: state.rows,
      filters: {},
      generatedAt: "2026-11-01T00:00:00.000Z",
    } as unknown as ReportResponse<PortfolioPerformanceRow[]>,
    error: null,
    isLoading: false,
    refetch: () => {},
  }),
  getPortfolioPerformance: vi.fn(),
}));
vi.mock("@/components/reports/filters/useReportFilters", () => ({
  useReportFilters: () => ({
    filters: {
      fromDate: "2025-11-01T00:00:00.000Z",
      toDate: "2026-10-31T23:59:59.000Z",
    },
  }),
}));
vi.mock("@/components/reports/ReportsCurrencyContext", () => ({
  useReportsCurrency: () => ({ currencyKey: "EUR", locale: "en" }),
}));

const messages = { ...commonMessages, ...reportsMessages };
const copy = reportsMessages.reports.reports.portfolioPerformance;

const row = (
  overrides: Partial<PortfolioPerformanceRow> = {},
): PortfolioPerformanceRow => ({
  portfolioKey: "7",
  name: "Long-term",
  currency: "EUR",
  startValue: 1000,
  netContributions: 500,
  change: 120,
  changePercent: 8,
  dividends: 0,
  endValue: 1620,
  timeWeightedReturn: 10.5,
  moneyWeightedReturn: -2.25,
  moneyWeightedReturnAnnualized: false,
  missingSnapshotDates: [],
  ...overrides,
});

function renderReport(locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PortfolioPerformanceReport />
    </NextIntlClientProvider>,
  );
}

/** The cells of the body row whose first cell starts with `name`. */
function cellsOf(name: string) {
  const report = screen.getByTestId("portfolio-performance-report");
  const tableRow = within(report)
    .getAllByRole("row")
    .find((r) => r.querySelector("td")?.textContent?.startsWith(name));
  assert.ok(tableRow, `no row for ${name}`);
  return within(tableRow).getAllByRole("cell");
}

/** Index of a column by its header text. */
function columnIndex(header: string) {
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
  const index = headers.indexOf(header);
  assert.ok(index >= 0, `no column ${header}`);
  return index;
}

afterEach(() => {
  cleanup();
  state.rows = [];
});

test("each portfolio shows its time- and money-weighted returns, signed", () => {
  state.rows = [row()];

  renderReport();

  const cells = cellsOf("Long-term");
  assert.match(
    cells[columnIndex(copy.timeWeighted)].textContent ?? "",
    /\+10\.5%/,
  );
  assert.match(
    cells[columnIndex(copy.moneyWeighted)].textContent ?? "",
    /−2\.25%/,
  );
});

test("a money-weighted return over a year or more says it is a yearly rate", () => {
  state.rows = [
    row({ name: "Yearly", moneyWeightedReturnAnnualized: true }),
    row({ portfolioKey: "8", name: "Period", change: 1 }),
  ];

  renderReport();

  const mwr = columnIndex(copy.moneyWeighted);
  assert.ok(cellsOf("Yearly")[mwr].textContent?.includes(copy.perYear));
  assert.ok(!cellsOf("Period")[mwr].textContent?.includes(copy.perYear));
});

test("a return that cannot be measured is an em dash, not zero", () => {
  state.rows = [row({ timeWeightedReturn: null, moneyWeightedReturn: null })];

  renderReport();

  const cells = cellsOf("Long-term");
  for (const header of [copy.timeWeighted, copy.moneyWeighted]) {
    const cell = cells[columnIndex(header)];
    assert.equal(cell.textContent?.trim(), "—");
    assert.ok(cell.querySelector("[aria-label]"));
  }
});

test("a portfolio with days missing a snapshot says how many", () => {
  state.rows = [
    row({ missingSnapshotDates: ["2026-03-01", "2026-03-02", "2026-03-03"] }),
    row({ portfolioKey: "8", name: "Complete", change: 1 }),
  ];

  renderReport();

  assert.match(cellsOf("Long-term")[0].textContent ?? "", /^Long-term\D*3\D/);
  assert.equal(cellsOf("Complete")[0].textContent, "Complete");
});

test("the household total does not invent a combined rate", () => {
  state.rows = [row(), row({ portfolioKey: "8", name: "Other", change: 1 })];

  renderReport();

  const total = cellsOf(copy.total);
  assert.equal(total[columnIndex(copy.timeWeighted)].textContent?.trim(), "—");
  assert.equal(total[columnIndex(copy.moneyWeighted)].textContent?.trim(), "—");
});
