// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { BudgetRow } from "@/lib/budget/rows";

import enMessages from "../../messages/en/common.json";
import esMessages from "../../messages/es/common.json";
import ptMessages from "../../messages/pt/common.json";
import { BudgetCategoryActionsMenu } from "./BudgetCategoryActionsMenu";

const mutateAsync = vi.fn(async (_request: { amount?: number }) => ({}));

vi.mock("@/lib/api/budget/useEditBudgetCategory", () => ({
  default: () => ({ mutateAsync }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

beforeAll(() => {
  // Layout APIs Radix's popper and pointer handling call, which jsdom lacks.
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
  mutateAsync.mockClear();
});

const category: BudgetRow = {
  key: 42,
  name: "groceries",
  budgeted: 100,
  icon: "cart",
  textColor: "",
  bgColor: "",
  isSystemCategory: false,
  recurrency: 1,
  spent: 0,
  subRows: [],
};

const locales = [
  { locale: "en", messages: enMessages, typed: "1250.5" },
  { locale: "pt", messages: ptMessages, typed: "1250,5" },
  { locale: "es", messages: esMessages, typed: "1250,5" },
] as const;

for (const { locale, messages, typed } of locales) {
  test(`editing a category saves the amount typed into the sheet (${locale})`, async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <BudgetCategoryActionsMenu
            trigger={<button type="button">{messages.actions}</button>}
            budgetKey={7}
            year={2026}
            month={10}
            category={category}
            currency="EUR"
            onDelete={() => {}}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: messages.actions }));
    await user.click(
      await screen.findByRole("menuitem", { name: messages.edit }),
    );

    const amount = await screen.findByRole("textbox", {
      name: messages.amount,
    });
    await user.clear(amount);
    await user.type(amount, typed);

    assert.equal(document.activeElement, amount);
    assert.equal((amount as HTMLInputElement).value, typed);

    await user.click(screen.getByRole("button", { name: messages.save }));

    await waitFor(() => assert.equal(mutateAsync.mock.calls.length, 1));
    assert.equal(mutateAsync.mock.calls[0][0].amount, 1250.5);
  });
}
