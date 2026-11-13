// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { BudgetFull } from "@/lib/api/budget/useBudgetsFull";

import budgetMessages from "../../messages/en/budget.json";
import commonMessages from "../../messages/en/common.json";
import { BudgetsSections } from "./BudgetsSections";

vi.mock("./BudgetsTable", () => ({
  default: ({ budgets }: { budgets: BudgetFull[] }) => (
    <ul>
      {budgets.map((budget) => (
        <li key={budget.budgetKey}>{budget.name}</li>
      ))}
    </ul>
  ),
}));

afterEach(cleanup);

const messages = { ...commonMessages, ...budgetMessages };

const budget = (
  budgetKey: number,
  name: string,
  visibility?: BudgetFull["visibility"],
) => ({ budgetKey, name, visibility }) as BudgetFull;

function renderSections(budgets: BudgetFull[]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BudgetsSections budgets={budgets} actions={<button>Create</button>} />
    </NextIntlClientProvider>,
  );
}

test("one kind of budget is one list under the plain heading", () => {
  renderSections([budget(1, "Home"), budget(2, "Trips", "household")]);

  const headings = screen.getAllByRole("heading", { level: 2 });
  assert.deepEqual(
    headings.map((heading) => heading.textContent),
    [commonMessages.budgets],
  );
  assert.equal(screen.getAllByRole("list").length, 1);
  assert.ok(screen.getByRole("button", { name: "Create" }));
});

test("household and personal budgets are listed apart, household first", () => {
  renderSections([
    budget(1, "Mine", "personal"),
    budget(2, "Home"),
    budget(3, "Trips", "household"),
  ]);

  const headings = screen.getAllByRole("heading", { level: 2 });
  assert.deepEqual(
    headings.map((heading) => heading.textContent),
    [
      budgetMessages.budgetVisibility["household-budgets"],
      budgetMessages.budgetVisibility["personal-budgets"],
    ],
  );
  const [household, personal] = screen.getAllByRole("list");
  assert.deepEqual(
    within(household).getAllByRole("listitem").map((item) => item.textContent),
    ["Home", "Trips"],
  );
  assert.deepEqual(
    within(personal).getAllByRole("listitem").map((item) => item.textContent),
    ["Mine"],
  );
  // The page's one create action, not one per group.
  assert.equal(screen.getAllByRole("button", { name: "Create" }).length, 1);
});
