// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, test, vi } from "vitest";

import type { ReportResponse, SpendingVsNormalData } from "@/lib/api/reports/types";
import {
  EN_MONEY_PATTERN,
  setStoredPrivacyMode,
  WithPrivacyMode,
} from "@/lib/privacy/privacy-test-utils";

import commonMessages from "../../../messages/en/common.json";
import reportsMessages from "../../../messages/en/reports.json";
import { SpendingVsNormalReport } from "./SpendingVsNormalReport";

const state = vi.hoisted(() => ({
  response: undefined as ReportResponse<SpendingVsNormalData> | undefined,
}));

vi.mock("@/lib/api/reports/spendingVsNormal", () => ({
  default: () => ({
    data: state.response,
    error: null,
    isPending: false,
    refetch: () => {},
  }),
  getSpendingVsNormal: vi.fn(),
}));
vi.mock("@/lib/api/category/useCategories", () => ({
  default: () => ({ data: { categories: [] } }),
}));
vi.mock("@/components/reports/filters/useReportFilters", () => ({
  useReportFilters: () => ({
    filters: {
      accountKeys: [],
      categoryKeys: [],
      fromDate: "2026-11-01T00:00:00.000Z",
      includePending: false,
      includeTransfers: false,
      merchantKeys: [],
      tagKeys: [],
      timezone: "Europe/Lisbon",
      toDate: "2026-11-30T23:59:59.999Z",
    },
  }),
}));
vi.mock("@/components/reports/ReportsCurrencyContext", () => ({
  useReportsCurrency: () => ({ currencyKey: "EUR", locale: "en" }),
}));
// The month picker is a Select; the report's month is fixed in these tests.
vi.mock("@/components/reports/filters/MonthPicker", () => ({
  MonthPicker: ({ value }: { value: string }) => (
    <span data-testid="month">{value}</span>
  ),
  formatMonthLabel: () => "November 2026",
  monthKeyDateRange: () => ({
    fromDate: "2026-11-01T00:00:00.000Z",
    toDate: "2026-11-30T23:59:59.999Z",
  }),
  monthKeyOf: () => "2026-11",
  shiftMonthKey: (key: string) => key,
}));
// The treemap needs layout jsdom lacks; the table is its accessible equivalent and is under test.
vi.mock("@/components/ui/charts", () => ({ TreemapChartBase: () => null }));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));

const messages = {
  ...commonMessages,
  ...reportsMessages,
  "privacy-mode": { "hidden-amount": "Hidden amount" },
};

const rows: SpendingVsNormalData["rows"] = [
  { categoryKey: "19", name: "Home", normal: 300, parentKey: null, ratio: 1, total: 300 },
  { categoryKey: "20", name: "Rent", normal: 300, parentKey: "19", ratio: 1, total: 300 },
  { categoryKey: "9", name: "Food", normal: 100, parentKey: null, ratio: 2, total: 200 },
  { categoryKey: "10", name: "Groceries", normal: 100, parentKey: "9", ratio: 1.5, total: 150 },
  { categoryKey: "11", name: "Restaurants", normal: null, parentKey: "9", ratio: null, total: 50 },
];

function respond(
  data: SpendingVsNormalData,
  unconvertedTransactions = 0,
): ReportResponse<SpendingVsNormalData> {
  return {
    completeness: {
      currencyCode: "EUR",
      isComplete: unconvertedTransactions === 0,
      unconvertedTransactions,
    },
    data,
    filters: {},
    generatedAt: "2026-11-10T00:00:00.000Z",
  };
}

function renderReport(wrapper?: (children: ReactNode) => ReactNode) {
  const content = (
    <NextIntlClientProvider locale="en" messages={messages}>
      <SpendingVsNormalReport />
    </NextIntlClientProvider>
  );
  return render(wrapper ? wrapper(content) : content);
}

function tableRow(name: string): HTMLElement {
  const row = screen
    .getAllByRole("row")
    .find((candidate) => candidate.textContent?.includes(name));
  assert.ok(row, `no row for ${name}`);
  return row;
}

afterEach(() => {
  cleanup();
  state.response = undefined;
  setStoredPrivacyMode(false);
});

test("the table lists every tile's figures, including subcategories", () => {
  state.response = respond({ month: "2026-11", rows });

  renderReport();

  const table = screen.getByRole("table");
  const text = table.textContent ?? "";
  for (const name of ["Home", "Rent", "Food", "Groceries", "Restaurants"]) {
    assert.ok(text.includes(name), `missing ${name}`);
  }
  assert.match(tableRow("Groceries").textContent ?? "", /\+50%/);
  assert.match(tableRow("Groceries").textContent ?? "", /above normal/);
  assert.match(tableRow("Rent").textContent ?? "", /0%/);
});

test("a category without a baseline is neutral, not above normal", () => {
  state.response = respond({ month: "2026-11", rows });

  renderReport();

  const restaurants = tableRow("Restaurants");
  assert.match(restaurants.textContent ?? "", /—/);
  assert.match(restaurants.textContent ?? "", /No baseline/);
  assert.doesNotMatch(restaurants.textContent ?? "", /above normal/);
});

test("a baseline too small to compare is neutral and says why", () => {
  state.response = respond({
    month: "2026-11",
    rows: [
      {
        categoryKey: "30",
        name: "Coffee",
        normal: 10,
        parentKey: null,
        ratio: null,
        total: 30,
      },
    ],
  });

  renderReport();

  const coffee = tableRow("Coffee");
  assert.match(coffee.textContent ?? "", /Too small to compare/);
  assert.doesNotMatch(coffee.textContent ?? "", /above normal/);
});

test("each row links to the transactions behind its amount", () => {
  state.response = respond({ month: "2026-11", rows });

  renderReport();

  const link = within(tableRow("Groceries")).getByRole("link", {
    name: /See the transactions behind this amount/,
  });
  const url = new URL(link.getAttribute("href") ?? "", "https://app.example");
  assert.match(url.pathname, /\/accounts\/transactions$/);
  assert.equal(url.searchParams.get("fromDate"), "2026-11-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("toDate"), "2026-11-30T23:59:59.999Z");
  assert.equal(url.searchParams.get("categoryKeys"), "10");
  assert.equal(url.searchParams.get("direction"), "out");
  // The report counts a pending row as committed and never counts a transfer.
  assert.equal(url.searchParams.get("statuses"), "BOOKED,PENDING");
  assert.equal(url.searchParams.get("excludeTransfers"), "true");
  assert.equal(url.searchParams.get("excludeNonSpending"), "true");
});

test("a top-level row's link asks for the subcategories its money sits in", () => {
  state.response = respond({ month: "2026-11", rows });

  renderReport();

  const link = within(tableRow("Food")).getByRole("link", {
    name: /See the transactions behind this amount/,
  });
  const url = new URL(link.getAttribute("href") ?? "", "https://app.example");
  assert.equal(url.searchParams.get("categoryKeys"), "9,10,11");
});

test("the report says how many rows it could not value", () => {
  state.response = respond({ month: "2026-11", rows }, 2);

  renderReport();

  assert.match(
    screen.getByRole("note").textContent ?? "",
    /2 transactions are left out/,
  );
});

test("privacy mode masks every amount in the table", () => {
  state.response = respond({ month: "2026-11", rows });
  setStoredPrivacyMode(true);

  renderReport((content) => <WithPrivacyMode hidden>{content}</WithPrivacyMode>);

  const text = screen.getByRole("table").textContent ?? "";
  assert.doesNotMatch(text, EN_MONEY_PATTERN);
  assert.match(text, /Hidden amount/);
});

test("a month with no spending says so", () => {
  state.response = respond({ month: "2026-11", rows: [] });

  renderReport();

  assert.match(screen.getByTestId("spending-vs-normal-report").textContent ?? "", /No spending this month/);
});
