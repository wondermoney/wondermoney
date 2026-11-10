// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import { BudgetCategoryEditSheet } from "./BudgetCategoryEditSheet";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_variables: unknown) => ({})),
  refresh: vi.fn(),
}));

vi.mock("@/lib/api/budget/useEditBudgetCategory", () => ({
  default: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock("@/lib/api/budget/useBudgetSuggestions", () => ({
  default: () => ({
    data: {
      categories: [
        {
          average: 100,
          categoryKey: 7,
          categoryName: "Groceries",
          hasEnoughData: true,
          median: 100,
          monthsWithData: 3,
          suggested: 105,
        },
      ],
      currencyCode: "EUR",
      months: 3,
      targetMonth: { month: 5, year: 2026 },
    },
  }),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: () => {} }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  mocks.mutateAsync.mockClear();
  mocks.refresh.mockClear();
});

const category = {
  key: 7,
  name: "Groceries",
  budgeted: 100,
  icon: "cart",
  textColor: "",
  bgColor: "",
  isSystemCategory: false,
  spent: 0,
  subRows: [],
};

function renderSheet(overrides: Partial<typeof category> & { rolloverEnabled?: boolean } = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BudgetCategoryEditSheet
          budgetKey={3}
          year={2026}
          month={5}
          category={{ ...category, ...overrides }}
          currency="EUR"
          open
          onOpenChange={() => {}}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return screen.getByRole("textbox", { name: enMessages.amount });
}

async function submitAmount(value: string) {
  const input = renderSheet();
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
  await userEvent.click(screen.getByRole("button", { name: enMessages.save }));
}

for (const [label, value, error] of [
  ["blank", "", "invalid-amount"],
  ["unreadable", "1.2.3", "invalid-amount"],
  ["zero", "0", "budget-amount-positive"],
] as const) {
  test(`a ${label} amount shows an inline error and saves nothing`, async () => {
    await submitAmount(value);

    await screen.findByText(enMessages[error]);
    assert.equal(mocks.mutateAsync.mock.calls.length, 0);
  });
}

test("an English reader's 1.000 is one, not a thousand", async () => {
  await submitAmount("1.000");

  await vi.waitFor(() => assert.equal(mocks.mutateAsync.mock.calls.length, 1));
  assert.equal((mocks.mutateAsync.mock.calls[0]?.[0] as { amount: number }).amount, 1);
});

test("a comma-decimal amount is saved as the number the user meant, then the page refreshes", async () => {
  await submitAmount("12,5");

  await vi.waitFor(() => assert.equal(mocks.refresh.mock.calls.length, 1));
  assert.deepEqual(mocks.mutateAsync.mock.calls[0]?.[0], {
    amount: 12.5,
    applyToFollowingMonths: true,
    budgetKey: 3,
    categoryKey: 7,
    month: 5,
    recurrency: "MONTHLY",
    rolloverEnabled: false,
    year: 2026,
  });
});

test("the yearly preview reads a comma-decimal amount instead of showing NaN", async () => {
  const input = renderSheet();
  await userEvent.clear(input);
  await userEvent.type(input, "12,5");

  const sheet = screen.getByRole("dialog");
  assert.doesNotMatch(sheet.textContent ?? "", /NaN/);
  assert.match(sheet.textContent ?? "", /150/);
});

test("turning on rollover saves it for this and the following months", async () => {
  renderSheet();
  const toggle = screen.getByRole("switch", { name: enMessages["budget-rollover-toggle"] });
  assert.equal(toggle.getAttribute("aria-checked"), "false");

  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole("button", { name: enMessages.save }));

  await vi.waitFor(() => assert.equal(mocks.mutateAsync.mock.calls.length, 1));
  const sent = mocks.mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
  assert.equal(sent.rolloverEnabled, true);
  assert.equal(sent.applyToFollowingMonths, true);
});

test("a category with rollover on opens with the switch on, and turning it off for this month only says so", async () => {
  renderSheet({ rolloverEnabled: true });
  const toggle = screen.getByRole("switch", { name: enMessages["budget-rollover-toggle"] });
  assert.equal(toggle.getAttribute("aria-checked"), "true");

  await userEvent.click(toggle);
  await userEvent.click(
    screen.getByRole("checkbox", { name: enMessages["apply-change-months"] }),
  );
  await userEvent.click(screen.getByRole("button", { name: enMessages.save }));

  await vi.waitFor(() => assert.equal(mocks.mutateAsync.mock.calls.length, 1));
  const sent = mocks.mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
  assert.equal(sent.rolloverEnabled, false);
  assert.equal(sent.applyToFollowingMonths, false);
});

test("applying the spending suggestion fills the amount and saves it", async () => {
  renderSheet();

  const applySuggestion = await screen.findByRole("button", {
    name: enMessages["budget-suggestion-apply"],
  });
  await userEvent.click(applySuggestion);
  await userEvent.click(screen.getByRole("button", { name: enMessages.save }));

  await vi.waitFor(() => assert.equal(mocks.mutateAsync.mock.calls.length, 1));
  assert.equal((mocks.mutateAsync.mock.calls[0]?.[0] as { amount: number }).amount, 105);
});
