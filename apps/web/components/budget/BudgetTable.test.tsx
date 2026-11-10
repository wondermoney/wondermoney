// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import budgetMessages from "../../messages/en/budget.json";
import commonMessages from "../../messages/en/common.json";
import BudgetTable, { type BudgetRow } from "./BudgetTable";

vi.mock("@/lib/api/budget/useDeleteBudgetCategory", () => ({
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));
vi.mock("@/lib/utils/useTailwindBreakpoints", () => ({ useBreakpoint: () => false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

const messages = { ...commonMessages, ...budgetMessages };

const child = (overrides: Partial<BudgetRow>) => ({
  key: 7,
  name: "Groceries",
  budgeted: 100,
  recurrency: 12,
  spent: 120,
  icon: "cart",
  textColor: "",
  bgColor: "",
  isSystemCategory: false,
  ...overrides,
});

function renderTable(subRows: ReturnType<typeof child>[]) {
  const rolledOver = subRows.reduce((sum, row) => sum + (row.rolledOver ?? 0), 0);
  const budget: BudgetRow[] = [
    {
      ...child({ key: 1, name: "Living" }),
      budgeted: subRows.reduce((sum, row) => sum + row.budgeted, 0),
      spent: subRows.reduce((sum, row) => sum + row.spent, 0),
      recurrency: undefined,
      rolledOver,
      subRows,
    },
  ];
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BudgetTable
        budget={budget}
        budgetKey={3}
        year={2026}
        month={5}
        currency="EUR"
        view="month"
        noActions
      />
    </NextIntlClientProvider>,
  );
}

// The table's text, spaces normalised: the carry line spreads over spans.
const pageText = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

test("a category with a surplus carried in says so under its plan, and measures what is left against plan plus carry", () => {
  renderTable([child({ rolledOver: 40, rolloverEnabled: true })]);

  assert.match(pageText(), /\+€40\.00 from last month/);
  // 100 planned + 40 carried − 120 spent: €20 left, not €20 over.
  assert.equal(screen.queryAllByText(commonMessages["over-budget"]).length, 0);
  assert.ok(
    screen.getAllByRole("img", {
      name: "Groceries: €120.00 spent of €140.00 planned",
    }).length > 0,
  );
});

test("an overspend carried in reads as a minus and the words, and can push the row over budget", () => {
  renderTable([child({ spent: 90, rolledOver: -25, rolloverEnabled: true })]);

  assert.match(pageText(), /−€25\.00 overspent last month/);
  // 100 planned − 25 carried − 90 spent: €15 over.
  assert.ok(screen.getAllByText(commonMessages["over-budget"]).length > 0);
});

test("a carry resting on unconverted spending carries an accessible warning", () => {
  renderTable([
    child({ rolledOver: 40, rolloverEnabled: true, rolloverIncomplete: true }),
  ]);

  assert.ok(
    screen.getAllByText(budgetMessages.budgetPage["rollover-incomplete"]).length > 0,
  );
});

test("a category without a carry shows no carry line", () => {
  renderTable([child({ spent: 50 })]);

  assert.doesNotMatch(pageText(), /last month/);
});
