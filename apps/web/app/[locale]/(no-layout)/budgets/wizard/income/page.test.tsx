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
  accounts: {
    data: {
      accounts: [
        { accountKey: 1, isPrivate: false },
        { accountKey: 2, isPrivate: false },
      ],
    },
  },
}));

const navigation = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return { push, replace, router: { push, replace, refresh: () => {} } };
});

const toasts = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toasts }));
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
  api.accounts.data.accounts = [
    { accountKey: 1, isPrivate: false },
    { accountKey: 2, isPrivate: false },
  ];
  useBudgetWizardStore.getState().reset();
  api.createBudget.mockClear();
  api.linkAccounts.mockReset();
  api.linkAccounts.mockImplementation(async () => ({}));
  navigation.push.mockClear();
  toasts.error.mockClear();
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

test("the budget is created with the visibility chosen on the first step", async () => {
  useBudgetWizardStore.getState().setVisibility("personal");
  renderPage();
  await pressContinue();

  assert.equal(api.createBudget.mock.calls.length, 1);
  const [request] = api.createBudget.mock.calls[0] as unknown as [{ visibility: string }];
  assert.equal(request.visibility, "personal");
});

test("a household budget links only the accounts that are not private", async () => {
  api.accounts.data.accounts = [
    { accountKey: 1, isPrivate: false },
    { accountKey: 2, isPrivate: true },
    { accountKey: 3, isPrivate: false },
  ];
  renderPage();
  await pressContinue();

  const [request] = api.createBudget.mock.calls[0] as unknown as [{ visibility: string }];
  assert.equal(request.visibility, "household");
  assert.deepEqual(api.linkAccounts.mock.calls, [[{ budgetKey: 41, accountKeys: [1, 3] }]]);
});

test("a personal budget links every account the user can see, private ones included", async () => {
  api.accounts.data.accounts = [
    { accountKey: 1, isPrivate: false },
    { accountKey: 2, isPrivate: true },
  ];
  useBudgetWizardStore.getState().setVisibility("personal");
  renderPage();
  await pressContinue();

  assert.deepEqual(api.linkAccounts.mock.calls, [[{ budgetKey: 41, accountKeys: [1, 2] }]]);
});

test("a household budget with only private accounts links none", async () => {
  api.accounts.data.accounts = [{ accountKey: 2, isPrivate: true }];
  renderPage();
  await pressContinue();

  assert.equal(api.linkAccounts.mock.calls.length, 0);
});

test("a viewer's refused create shows the household's read-only notice, not a second error", async () => {
  api.createBudget.mockImplementationOnce(async () => {
    throw { response: { status: 403, data: { code: "household_read_only" } } };
  });
  renderPage();

  await userEvent.click(screen.getByRole("button", { name: enMessages.continue }));
  await vi.waitFor(() => assert.equal(api.createBudget.mock.calls.length, 1));

  assert.equal(toasts.error.mock.calls.length, 0);
  assert.equal(navigation.push.mock.calls.length, 0);
});

test("any other failure to create says so", async () => {
  api.createBudget.mockImplementationOnce(async () => {
    throw new Error("boom");
  });
  renderPage();

  await userEvent.click(screen.getByRole("button", { name: enMessages.continue }));

  await vi.waitFor(() => assert.equal(toasts.error.mock.calls.length, 1));
  assert.equal(navigation.push.mock.calls.length, 0);
});
