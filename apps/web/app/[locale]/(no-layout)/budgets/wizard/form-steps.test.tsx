// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enMessages from "../../../../../messages/en/common.json";
import DependentsPage from "./dependents/page";
import HouseholdPage from "./household/page";
import { useBudgetWizardStore } from "./store";

const navigation = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return { push, replace, router: { push, replace, refresh: () => {} } };
});

vi.mock("@/i18n/navigation", () => ({ useRouter: () => navigation.router }));
// The dependents step uses Next's own router rather than the locale-aware one.
vi.mock("next/navigation", () => ({ useRouter: () => navigation.router }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  useBudgetWizardStore.getState().reset();
  navigation.push.mockClear();
  navigation.replace.mockClear();
});

function renderStep(step: React.ReactNode) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {step}
    </NextIntlClientProvider>,
  );
}

test("Continue on the household step saves the size and moves to dependents", async () => {
  renderStep(<HouseholdPage />);

  await userEvent.click(screen.getByRole("button", { name: enMessages.continue }));

  await vi.waitFor(() => assert.deepEqual(navigation.push.mock.calls, [["/budgets/wizard/dependents"]]));
  assert.deepEqual(useBudgetWizardStore.getState().household, { householdSize: 2 });
});

test("the household size the user picks with the slider is the one saved", async () => {
  renderStep(<HouseholdPage />);

  screen.getByRole("slider").focus();
  await userEvent.keyboard("{ArrowRight}");
  await userEvent.click(screen.getByRole("button", { name: enMessages.continue }));

  await vi.waitFor(() => assert.equal(navigation.push.mock.calls.length, 1));
  assert.deepEqual(useBudgetWizardStore.getState().household, { householdSize: 3 });
});

test("dependents left above a lowered household size are clamped, not blocked", async () => {
  const store = useBudgetWizardStore.getState();
  store.setHousehold({ householdSize: 2 });
  store.setDependents({ dependentsNum: 4 });
  renderStep(<DependentsPage />);

  await userEvent.click(screen.getByRole("button", { name: enMessages.continue }));

  await vi.waitFor(() => assert.deepEqual(navigation.push.mock.calls, [["/budgets/wizard/income"]]));
  assert.deepEqual(useBudgetWizardStore.getState().dependents, { dependentsNum: 2 });
});
