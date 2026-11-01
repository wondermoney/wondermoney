// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import WizardAddCategoryForm from "./WizardAddCategoryForm";

const api = vi.hoisted(() => ({
  createCategory: vi.fn(async () => ({ data: { category: { categoryKey: 99 } } })),
  addBudgetCategory: vi.fn(async () => ({})),
}));

vi.mock("@/lib/api/category/useCreateCategory", () => ({
  default: () => ({ mutateAsync: api.createCategory }),
}));
vi.mock("@/lib/api/budget/useAddBudgetCategory", () => ({
  default: () => ({ mutateAsync: api.addBudgetCategory }),
}));
vi.mock("@/lib/api/category/useCategories", () => ({
  default: () => ({
    data: {
      categories: [
        { categoryKey: 5, name: "Housing", bgColor: "#000000", isSystemCategory: false },
      ],
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  api.createCategory.mockClear();
  api.addBudgetCategory.mockClear();
});

function parentSelect() {
  // The parent picker is the first combobox; the recurrence picker follows it.
  const [parent] = screen.getAllByRole("combobox");
  if (!parent) throw new Error("no parent category select");
  return parent;
}

async function choose(trigger: HTMLElement, option: string) {
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

test("switching back to no parent clears the budget, so the category can still be created", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WizardAddCategoryForm budgetId="3" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: enMessages["budget-show-advanced-category-options"] }),
  );
  await userEvent.type(screen.getByRole("textbox", { name: new RegExp(enMessages.name) }), "Rent");

  await choose(parentSelect(), "Housing");
  const amount = screen.getByRole("textbox", { name: enMessages["budget-amount"] }) as HTMLInputElement;
  await userEvent.clear(amount);
  await userEvent.type(amount, "50");

  await choose(parentSelect(), enMessages.none);

  assert.equal(amount.value, "0");
  assert.equal(amount.disabled, true);

  await userEvent.click(screen.getByRole("button", { name: enMessages["create-category"] }));
  await vi.waitFor(() => assert.equal(api.createCategory.mock.calls.length, 1));
  assert.equal(api.addBudgetCategory.mock.calls.length, 0);
});
