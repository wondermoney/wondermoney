// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import BudgetTable, { type BudgetRow } from "./BudgetTableNew";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/budget/useEditBudgetCategory", () => ({
  default: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/lib/api/budget/useRemoveCategoryFromBudget", () => ({
  default: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));
vi.mock("@/lib/utils/useTailwindBreakpoints", () => ({ useBreakpoint: () => false }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));

afterEach(() => {
  cleanup();
  mocks.mutate.mockClear();
  mocks.toastError.mockClear();
});

const subRow = {
  key: 7,
  name: "Groceries",
  budgeted: 100,
  icon: "cart",
  textColor: "",
  bgColor: "",
  isSystemCategory: false,
};
const budget: BudgetRow[] = [
  { ...subRow, key: 1, name: "Living", subRows: [subRow] },
];

async function commit(value: string) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BudgetTable budget={budget} budgetKey={3} year={2026} month={5} monthlyIncome={2000} currency="EUR" />
      <button type="button">elsewhere</button>
    </NextIntlClientProvider>,
  );
  // The mobile list and the desktop table share the same editor; either one will do.
  const [input] = screen.getAllByDisplayValue("100.00") as HTMLInputElement[];
  if (!input) throw new Error("no editable budget cell");
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
  await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
  return input;
}

for (const [label, value] of [["blank", ""], ["zero", "0"], ["negative", "-5"]] as const) {
  test(`a ${label} amount is refused before anything is saved, and the cell reverts`, async () => {
    const input = await commit(value);

    assert.equal(mocks.mutate.mock.calls.length, 0);
    assert.equal(mocks.toastError.mock.calls.length, 1);
    assert.equal(input.value, "100.00");
  });
}

test("a comma-decimal amount is saved as the number the user meant", async () => {
  await commit("12,5");

  assert.equal(mocks.mutate.mock.calls.length, 1);
  assert.deepEqual(mocks.mutate.mock.calls[0]?.[0], {
    amount: 12.5,
    budgetKey: 3,
    categoryKey: 7,
    month: 5,
    year: 2026,
  });
});
