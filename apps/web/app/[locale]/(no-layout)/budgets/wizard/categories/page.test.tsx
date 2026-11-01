// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../../../../../messages/en/common.json";
import { WIZARD_START_ROUTE } from "../hooks/useRequireWizardBudget";
import { useBudgetWizardStore } from "../store";
import CategoriesPage from "./page";

// Query hooks hand back the same object until data changes; fresh objects
// every render would loop the page's derived state.
const queries = vi.hoisted(() => ({
  budget: { data: { budgetKey: 12 }, isLoading: false },
  template: {
    data: {
      budget: {
        incomes: [] as { amount: number }[],
        categories: [] as Record<string, unknown>[],
        currencyCode: "EUR",
      },
    },
    isLoading: false,
  },
  edit: {
    mutate: () => {},
    mutateAsync: vi.fn<(variables: unknown) => Promise<unknown>>(async () => ({})),
  },
}));

const emptyTemplate = queries.template;

function category(key: number, parent: string, child: string | null, budgeted: number) {
  return {
    category_key: key,
    parent_category_name: parent,
    child_category_name: child,
    category_budgeted_amount: budgeted,
    category_amount: 0,
    category_recurrency: null,
    category_is_system_category: true,
    category_icon: "",
    category_text_color: "",
    category_bg_color: "",
  };
}

const navigation = vi.hoisted(() => {
  const replace = vi.fn();
  const push = vi.fn();
  // One stable router, as next-intl's `useRouter` returns across renders.
  return { replace, push, router: { replace, push, refresh: () => {} } };
});

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => navigation.router,
}));
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({ id: "user-1" }),
}));
vi.mock("@/lib/onboarding/firstRunOnboarding", () => ({
  completeFirstRunHandoff: () => false,
  getFirstRunStepRoute: (step: string) => `/onboarding/${step}`,
}));
vi.mock("@/lib/api/budget/useBudget", () => ({
  default: () => queries.budget,
}));
vi.mock("@/lib/api/budget/useBudgetTemplateByYearAndMonth", () => ({
  default: () => queries.template,
}));
vi.mock("@/lib/api/budget/useEditBudgetCategory", () => ({
  default: () => queries.edit,
}));
// The real table has its own test; this stand-in just shows the amounts it was given.
vi.mock("@/components/budget/BudgetTableNew", () => ({
  default: ({ budget }: { budget: { key: number; budgeted: number; subRows: { key: number; budgeted: number }[] }[] }) => (
    <ul aria-label="budget rows">
      {budget.flatMap((row) => row.subRows).map((row) => (
        <li key={row.key}>{`${row.key}:${row.budgeted}`}</li>
      ))}
    </ul>
  ),
}));
vi.mock("@/components/budget/WizardAddCategoryForm", () => ({
  default: () => null,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

afterEach(() => {
  cleanup();
  queries.template = emptyTemplate;
  queries.edit.mutateAsync.mockReset();
  queries.edit.mutateAsync.mockImplementation(async () => ({}));
  navigation.replace.mockClear();
  useBudgetWizardStore.getState().reset();
});

test("Finish lands on the budget the wizard just created", async () => {
  useBudgetWizardStore.getState().setBudgetId(12);
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CategoriesPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: enMessages.finish }));

  const destinations = navigation.replace.mock.calls.map(([href]) => href);
  assert.ok(destinations.length > 0, "Finish navigates somewhere");
  assert.match(
    destinations.at(-1),
    /^\/budgets\/12\/\d{4}\/\d{1,2}$/,
    `the last navigation wins; got ${JSON.stringify(destinations)}`,
  );
  // Finish clears the wizard, so the wizard state is ready for a fresh start.
  assert.equal(useBudgetWizardStore.getState().budgetId, undefined);
});

test("the categories step without a budget sends the user to the wizard start", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CategoriesPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

  assert.deepEqual(
    navigation.replace.mock.calls.map(([href]) => href),
    [WIZARD_START_ROUTE],
  );
});

function renderWithRent(rent: number) {
  useBudgetWizardStore.getState().setBudgetId(12);
  queries.template = {
    data: {
      budget: {
        incomes: [{ amount: 1000 }],
        categories: [category(1, "HOUSING", null, rent), category(2, "HOUSING", "RENT_MORTGAGE", rent)],
        currencyCode: "EUR",
      },
    },
    isLoading: false,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CategoriesPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const rentRow = () => screen.getByRole("list", { name: "budget rows" }).textContent;

test("picking a starter profile previews it without touching the budget", async () => {
  renderWithRent(100);

  await userEvent.click(
    screen.getByRole("radio", { name: new RegExp(enMessages["budget-starter-profile-single"]) }),
  );

  assert.equal(rentRow(), "2:100");
  assert.equal(queries.edit.mutateAsync.mock.calls.length, 0);
  assert.ok(screen.getByRole("button", { name: enMessages["budget-starter-profile-apply"] }));
});

test("applying the suggestions saves them first and only then shows them in the table", async () => {
  let finishSave: () => void = () => {};
  queries.edit.mutateAsync.mockImplementation(
    () => new Promise((resolve) => { finishSave = () => resolve({}); }),
  );
  renderWithRent(100);

  await userEvent.click(
    screen.getByRole("radio", { name: new RegExp(enMessages["budget-starter-profile-single"]) }),
  );
  await userEvent.click(screen.getByRole("button", { name: enMessages["budget-starter-profile-apply"] }));

  assert.equal(queries.edit.mutateAsync.mock.calls.length, 1);
  const [saved] = queries.edit.mutateAsync.mock.calls[0] as [{ categoryKey: number; amount: number }];
  assert.equal(saved.categoryKey, 2);
  assert.notEqual(saved.amount, 100);
  assert.equal(rentRow(), "2:100", "the table waits for the save");

  await act(async () => finishSave());

  await vi.waitFor(() => assert.equal(rentRow(), `2:${saved.amount}`));
});

test("a failed save leaves the table as it was", async () => {
  queries.edit.mutateAsync.mockImplementation(async () => {
    throw new Error("network");
  });
  renderWithRent(100);

  await userEvent.click(
    screen.getByRole("radio", { name: new RegExp(enMessages["budget-starter-profile-single"]) }),
  );
  await userEvent.click(screen.getByRole("button", { name: enMessages["budget-starter-profile-apply"] }));

  await vi.waitFor(() => assert.equal(queries.edit.mutateAsync.mock.calls.length, 1));
  assert.equal(rentRow(), "2:100");
});
