// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/home.json";
import { CustomizeHomeSheet } from "./CustomizeHomeSheet";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  mutate: vi.fn(),
  mutation: { isPending: false, isError: false },
}));

vi.mock("@/lib/api/user-preferences/useUserPreferences", () => ({
  default: () => state.query,
}));
vi.mock("@/lib/api/user-preferences/useUpdateUserPreferences", () => ({
  default: () => ({ mutate: state.mutate, ...state.mutation }),
}));

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
  state.mutation = { isPending: false, isError: false };
});

function renderSheet(
  dashboardLayout?: { id: string; hidden: boolean }[],
  query: Record<string, unknown> = {},
) {
  state.query = {
    isPending: false,
    isError: false,
    refetch: () => {},
    data: { previewFeatures: false, dashboardLayout },
    ...query,
  };
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CustomizeHomeSheet open onOpenChange={onOpenChange} />
    </NextIntlClientProvider>,
  );
  return { onOpenChange };
}

const sectionNames = () =>
  screen.getAllByRole("switch").map((element) => element.getAttribute("id"));

test("lists every section in the saved order, net worth first", () => {
  renderSheet([
    { id: "net-worth", hidden: false },
    { id: "loans", hidden: false },
    { id: "this-month", hidden: true },
    { id: "latest-transactions", hidden: false },
    { id: "balance-sheet", hidden: true },
    { id: "cashflow", hidden: false },
  ]);

  assert.deepEqual(sectionNames(), [
    "home-section-net-worth",
    "home-section-loans",
    "home-section-this-month",
    "home-section-latest-transactions",
    "home-section-balance-sheet",
    "home-section-cashflow",
  ]);
  assert.equal(
    screen.getByRole("switch", { name: "This month" }).getAttribute(
      "aria-checked",
    ),
    "false",
  );
  assert.equal(
    screen.getByRole("switch", { name: "Loans" }).getAttribute("aria-checked"),
    "true",
  );
});

test("moves a section down and saves the whole layout", async () => {
  renderSheet();

  await userEvent.click(screen.getByRole("button", { name: "Move This month down" }));

  assert.deepEqual(state.mutate.mock.calls[0], [
    {
      dashboardLayout: [
        { id: "net-worth", hidden: false },
        { id: "balance-sheet", hidden: false },
        { id: "this-month", hidden: false },
        { id: "cashflow", hidden: false },
        { id: "loans", hidden: false },
        { id: "latest-transactions", hidden: false },
      ],
    },
  ]);
});

test("hides a section with its visibility switch", async () => {
  renderSheet();

  await userEvent.click(screen.getByRole("switch", { name: "Loans" }));

  assert.deepEqual(state.mutate.mock.calls[0], [
    {
      dashboardLayout: [
        { id: "net-worth", hidden: false },
        { id: "this-month", hidden: false },
        { id: "balance-sheet", hidden: false },
        { id: "cashflow", hidden: false },
        { id: "loans", hidden: true },
        { id: "latest-transactions", hidden: false },
      ],
    },
  ]);
});

test("net worth cannot be moved or hidden", () => {
  renderSheet();

  const netWorthSwitch = screen.getByRole("switch", { name: "Net worth" });
  assert.equal(netWorthSwitch.getAttribute("aria-checked"), "true");
  assert.equal(netWorthSwitch.hasAttribute("disabled"), true);
  assert.equal(
    screen.getByRole("button", { name: "Move Net worth up" }).hasAttribute(
      "disabled",
    ),
    true,
  );
  assert.equal(
    screen.getByRole("button", { name: "Move Net worth down" }).hasAttribute(
      "disabled",
    ),
    true,
  );
  assert.ok(screen.getByText("Always shown first"));
});

test("reset stores the default order", async () => {
  renderSheet([
    { id: "net-worth", hidden: false },
    { id: "loans", hidden: true },
  ]);

  await userEvent.click(screen.getByRole("button", { name: "Reset to default" }));

  assert.deepEqual(state.mutate.mock.calls[0], [{ dashboardLayout: [] }]);
});

test("a failed save offers a retry with the same layout", async () => {
  state.mutation = { isPending: false, isError: true };
  renderSheet();

  assert.ok(screen.getByText("Could not save. Try again."));

  await userEvent.click(screen.getByRole("button", { name: "Try again" }));

  assert.equal(state.mutate.mock.calls[0]?.[0].dashboardLayout.length, 6);
});

test("a failed load explains itself and offers a retry", async () => {
  const refetch = vi.fn();
  renderSheet(undefined, { isError: true, refetch });

  assert.ok(screen.getByText("Could not load your home layout."));

  await userEvent.click(screen.getByRole("button", { name: "Try again" }));

  assert.equal(refetch.mock.calls.length, 1);
});
