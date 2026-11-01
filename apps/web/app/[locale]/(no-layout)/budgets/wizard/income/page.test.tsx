// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import enMessages from "../../../../../../messages/en/common.json";
import { useBudgetWizardStore } from "../store";
import IncomePage from "./page";

const api = vi.hoisted(() => ({
  createBudget: vi.fn(async () => ({ data: { budgetKey: 41 } })),
  linkAccounts: vi.fn(async () => ({})),
  accounts: { data: { accounts: [{ accountKey: 1 }, { accountKey: 2 }] } },
}));

const navigation = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return { push, replace, router: { push, replace, refresh: () => {} } };
});

vi.mock("@/i18n/navigation", () => ({ useRouter: () => navigation.router }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: () => {} }) }));
vi.mock("@/lib/api/budget/useCreateBudget", () => ({
  default: () => ({ mutateAsync: api.createBudget }),
}));
vi.mock("@/lib/api/budget/useEditBudgetTemplateAccounts", () => ({
  default: () => ({ mutateAsync: api.linkAccounts }),
}));
vi.mock("@/lib/api/account/useAccounts", () => ({ default: () => api.accounts }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  const store = useBudgetWizardStore.getState();
  store.setHousehold({ householdSize: 2 });
  store.setDependents({ dependentsNum: 0 });
});

afterEach(() => {
  cleanup();
  useBudgetWizardStore.getState().reset();
  api.createBudget.mockClear();
  api.linkAccounts.mockReset();
  api.linkAccounts.mockImplementation(async () => ({}));
  navigation.push.mockClear();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <IncomePage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function pressContinue() {
  await userEvent.click(screen.getByRole("button", { name: enMessages.continue }));
  await vi.waitFor(() => assert.ok(navigation.push.mock.calls.length > 0));
}

test("continuing creates the budget and links every account the user can see", async () => {
  renderPage();
  await pressContinue();

  assert.equal(api.createBudget.mock.calls.length, 1);
  assert.deepEqual(api.linkAccounts.mock.calls, [[{ budgetKey: 41, accountKeys: [1, 2] }]]);
  assert.deepEqual(navigation.push.mock.calls, [["/budgets/wizard/categories"]]);
});

test("a failure to link accounts does not stop the wizard", async () => {
  api.linkAccounts.mockImplementation(async () => {
    throw new Error("link failed");
  });
  renderPage();
  await pressContinue();

  assert.equal(api.createBudget.mock.calls.length, 1);
  assert.deepEqual(navigation.push.mock.calls, [["/budgets/wizard/categories"]]);
});

test("coming back to this step after the budget exists does not create a second one", async () => {
  useBudgetWizardStore.getState().setBudgetId(41);
  renderPage();
  await pressContinue();

  assert.equal(api.createBudget.mock.calls.length, 0);
  assert.deepEqual(navigation.push.mock.calls, [["/budgets/wizard/categories"]]);
});
