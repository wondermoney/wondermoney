// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { BudgetForecastMonth, GetBudgetForecastResponse } from "@/lib/api/budget/useBudgetForecast";

import budgetMessages from "../../messages/en/budget.json";
import commonMessages from "../../messages/en/common.json";
import { BudgetForecastView } from "./BudgetForecast";

// Recharts measures its container, which jsdom cannot do; the table is what is under test.
vi.mock("@/components/ui/charts", () => ({ BarChartBase: () => null, niceTicks: () => [0] }));

afterEach(cleanup);

const month = (overrides: Partial<BudgetForecastMonth>): BudgetForecastMonth => ({
  available: 300,
  budgeted: 300,
  carriedIn: 0,
  complete: true,
  expectedSpend: 300,
  income: 2000,
  kind: "future",
  month: 12,
  net: 1700,
  projectedSpend: 45,
  recurring: [],
  spent: null,
  year: 2026,
  ...overrides,
});

const forecast = (months: BudgetForecastMonth[], overrides: Partial<GetBudgetForecastResponse> = {}): GetBudgetForecastResponse => ({
  asOf: "2026-11-09",
  basis: { plannedIncome: [{ amount: 2000, name: "Salary" }], recurringItems: [{ amount: 45, cadence: "monthly", categoryKey: 1, currencyCode: "EUR", name: "Veg box", originalAmount: 45, recurringSeriesKey: 1 }] },
  budgetKey: 3,
  completeness: { currencyCode: "EUR", isComplete: true, unconvertedCurrencies: [], unconvertedRecurringItems: 0, unconvertedTransactions: 0 },
  currencyCode: "EUR",
  months,
  ...overrides,
});

function renderView(data: GetBudgetForecastResponse) {
  render(
    <NextIntlClientProvider locale="en" messages={{ ...commonMessages, ...budgetMessages }}>
      <BudgetForecastView forecast={data} />
    </NextIntlClientProvider>,
  );
}

test("shows spending only for the current month and marks later months as projected", () => {
  renderView(forecast([month({ kind: "current", month: 11, spent: 120 }), month({})]));

  const [, november, december] = screen.getAllByRole("row");
  assert.ok(november && december);
  assert.match(within(november).getByText(/so far/i).textContent ?? "", /actual so far/i);
  assert.match(november.textContent ?? "", /120\.00/);
  assert.match(within(december).getByText("Projected").textContent ?? "", /Projected/);
  // A future month has no spending: an em dash, never a zero.
  const decemberCells = within(december).getAllByRole("cell");
  assert.equal(decemberCells[3]?.textContent?.trim(), "—");
});

test("says what the forecast rests on", () => {
  renderView(forecast([month({ kind: "current", month: 11, spent: 0 })]));

  assert.ok(screen.getByText(/1 recurring item,/));
  assert.ok(screen.getByText(/Nov 9, 2026/));
  assert.ok(screen.getByText("Veg box"));
});

test("flags a forecast whose amounts could not all be converted", () => {
  renderView(forecast([month({ complete: false, kind: "current", month: 11, spent: 0 })], {
    completeness: { currencyCode: "EUR", isComplete: false, unconvertedCurrencies: ["GBP"], unconvertedRecurringItems: 1, unconvertedTransactions: 0 },
  }));

  assert.ok(screen.getByRole("note").textContent?.includes("GBP"));
  assert.ok(screen.getByText(/incomplete/));
});
