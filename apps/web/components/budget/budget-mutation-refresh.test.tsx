// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import BudgetDeleteModal from "./BudgetDeleteModal";
import BudgetEditModal from "./BudgetEditModal";

/*
 * The budgets overview renders its rows from Server Component props, which a
 * client-cache invalidation never reaches. Renaming or deleting a budget has to
 * refresh the route too, or the overview keeps showing the old row.
 */

type Callbacks = { onSuccess?: () => unknown; onSettled?: () => unknown };

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: () => {} }) }));
// Stand-ins that succeed and run the caller's callbacks, as react-query does.
vi.mock("@/lib/api/budget/useEditBudget", () => ({
  default: () => ({
    mutateAsync: async (variables: unknown, callbacks: Callbacks) => {
      h.edit(variables);
      await callbacks.onSuccess?.();
      await callbacks.onSettled?.();
    },
  }),
}));
vi.mock("@/lib/api/budget/useDeleteBudget", () => ({
  default: () => ({
    mutate: (variables: unknown, callbacks: Callbacks) => {
      h.remove(variables);
      void callbacks.onSuccess?.();
    },
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Radix Select reads these, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  h.refresh.mockClear();
  h.edit.mockClear();
  h.remove.mockClear();
});

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient();
  const invalidated: unknown[] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: Parameters<typeof original>[0]) => {
    invalidated.push(filters?.queryKey);
    return original(filters);
  }) as typeof client.invalidateQueries;
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return invalidated;
}

const touchesBudgetList = (keys: unknown[]) =>
  keys.some((key) => Array.isArray(key) && key[0] === "budgets-full");

test("renaming a budget refreshes the route-backed overview and closes the sheet", async () => {
  const onOpenChange = vi.fn();
  const invalidated = renderWithClient(
    <BudgetEditModal isOpen onOpenChange={onOpenChange} budgetName="Home" budgetKey={4} />,
  );

  const name = screen.getByRole("textbox");
  await userEvent.clear(name);
  await userEvent.type(name, "House");
  await userEvent.click(screen.getByRole("button", { name: enMessages.save }));

  await vi.waitFor(() => assert.deepEqual(onOpenChange.mock.calls, [[false]]));
  assert.deepEqual(h.edit.mock.calls, [[{ budgetKey: 4, name: "House" }]]);
  assert.equal(h.refresh.mock.calls.length, 1);
  assert.ok(touchesBudgetList(invalidated));
});

test("turning off carried overspending sends only that change with the name", async () => {
  const onOpenChange = vi.fn();
  renderWithClient(
    <BudgetEditModal
      isOpen
      onOpenChange={onOpenChange}
      budgetName="Home"
      budgetKey={4}
      rolloverCarriesOverspend
    />,
  );

  const toggle = screen.getByRole("switch", {
    name: enMessages["budget-rollover-carries-overspend"],
  });
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole("button", { name: enMessages.save }));

  await vi.waitFor(() => assert.deepEqual(onOpenChange.mock.calls, [[false]]));
  assert.deepEqual(h.edit.mock.calls, [
    [{ budgetKey: 4, name: "Home", rolloverCarriesOverspend: false }],
  ]);
});

test("changing the day the budget month starts on sends only that change with the name", async () => {
  const onOpenChange = vi.fn();
  renderWithClient(
    <BudgetEditModal
      isOpen
      onOpenChange={onOpenChange}
      budgetName="Home"
      budgetKey={4}
      periodStartDay={1}
    />,
  );

  const startDay = screen.getByRole("combobox", {
    name: enMessages["budget-period-start-day"],
  });
  await userEvent.click(startDay);
  await userEvent.click(await screen.findByRole("option", { name: "Day 25" }));
  await userEvent.click(screen.getByRole("button", { name: enMessages.save }));

  await vi.waitFor(() => assert.deepEqual(onOpenChange.mock.calls, [[false]]));
  assert.deepEqual(h.edit.mock.calls, [
    [{ budgetKey: 4, name: "Home", periodStartDay: 25 }],
  ]);
});

test("the start day offers only days every month has, 1 to 28", async () => {
  renderWithClient(
    <BudgetEditModal
      isOpen
      onOpenChange={() => {}}
      budgetName="Home"
      budgetKey={4}
      periodStartDay={25}
    />,
  );

  const startDay = screen.getByRole("combobox", {
    name: enMessages["budget-period-start-day"],
  });
  assert.match(startDay.textContent ?? "", /Day 25/);
  await userEvent.click(startDay);
  const options = await screen.findAllByRole("option");
  assert.equal(options.length, 28);
  assert.equal(options[0].textContent, "Day 1");
  assert.equal(options.at(-1)?.textContent, "Day 28");
});

test("deleting a budget refreshes the route-backed overview and closes the dialog", async () => {
  const closeModal = vi.fn();
  const invalidated = renderWithClient(
    <BudgetDeleteModal isOpen closeModal={closeModal} budgetName="Home" budgetKey={4} />,
  );

  await userEvent.click(screen.getByRole("button", { name: enMessages.delete }));

  await vi.waitFor(() => assert.equal(closeModal.mock.calls.length, 1));
  assert.deepEqual(h.remove.mock.calls, [[{ budgetKey: 4 }]]);
  assert.equal(h.refresh.mock.calls.length, 1);
  assert.ok(touchesBudgetList(invalidated));
});
