// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import { BudgetSuggestionsCard } from "./BudgetSuggestionsCard";

const suggestions = [
  {
    average: 100,
    categoryKey: 10,
    categoryName: "Groceries",
    hasEnoughData: true,
    median: 100,
    monthsWithData: 3,
    suggested: 105,
  },
  {
    average: 40,
    categoryKey: 11,
    categoryName: "Transport",
    hasEnoughData: true,
    median: 40,
    monthsWithData: 2,
    suggested: 40,
  },
  {
    average: 12,
    categoryKey: 12,
    categoryName: "Books",
    hasEnoughData: false,
    median: 12,
    monthsWithData: 1,
    suggested: null,
  },
];

vi.mock("@/lib/api/budget/useBudgetSuggestions", () => ({
  default: () => ({
    data: {
      categories: suggestions,
      currencyCode: "EUR",
      months: 3,
      targetMonth: { month: 11, year: 2026 },
    },
    isLoading: false,
  }),
}));

afterEach(cleanup);

function renderCard(onApply = vi.fn(async (_updates: { amount: number; categoryKey: number }[]) => {})) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BudgetSuggestionsCard
          budgetKey={1}
          currency="EUR"
          month={11}
          onApply={onApply}
          rows={[
            {
              budgeted: 90,
              key: 10,
              subRows: [],
            },
            {
              budgeted: 30,
              key: 11,
              subRows: [],
            },
          ]}
          year={2026}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onApply;
}

test("shows each suggestion beside its current amount and flags short history", () => {
  renderCard();

  assert.ok(screen.getByText("Groceries"));
  assert.ok(screen.getByText("Transport"));
  assert.ok(screen.getByText(enMessages["budget-suggestions-not-enough-data"]));
});

test("Apply sends one category, and Apply all sends every suggested category", async () => {
  const onApply = renderCard();

  await userEvent.click(screen.getAllByRole("button", { name: enMessages["budget-suggestions-apply"] })[0]!);
  assert.deepEqual(onApply.mock.calls[0]?.[0], [{ amount: 105, categoryKey: 10 }]);

  await userEvent.click(screen.getByRole("button", { name: enMessages["budget-suggestions-apply-all"] }));
  assert.deepEqual(onApply.mock.calls[1]?.[0], [
    { amount: 105, categoryKey: 10 },
    { amount: 40, categoryKey: 11 },
  ]);
});
