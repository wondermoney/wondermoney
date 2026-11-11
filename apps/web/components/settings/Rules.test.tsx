// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { Rule } from "@/lib/api/rule/useRules";

import enCommon from "../../messages/en/common.json";
import enRules from "../../messages/en/rules.json";
import Rules from "./Rules";

const state = vi.hoisted(() => ({
  rules: [] as unknown[],
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  exportRules: vi.fn(),
}));

vi.mock("@/lib/api/rule/useRules", async (importOriginal) => {
  const actual = await importOriginal<object>();
  const { useQuery } = await import("@tanstack/react-query");
  // A real query, so the component's optimistic cache writes show on screen.
  const useRulesDouble = () =>
    useQuery({
      queryKey: ["rules"],
      queryFn: () => ({ rules: state.rules }),
    });
  return {
    ...actual,
    default: useRulesDouble,
    invalidateRules: vi.fn(),
    useUpdateRule: () => ({ mutateAsync: state.update, isPending: false }),
    useDeleteRule: () => ({ mutateAsync: state.remove, isPending: false }),
    useReorderRules: () => ({ mutateAsync: state.reorder, isPending: false }),
    useExportRules: () => ({
      mutateAsync: state.exportRules,
      isPending: false,
    }),
  };
});

vi.mock("@/components/rules/useRuleLookups", () => ({
  useRuleLookups: () => ({
    categories: [],
    lookups: {
      category: (key: number) => ({ 1: "Entertainment", 2: "Groceries" })[key],
      account: () => undefined,
      tag: () => undefined,
      transactionType: (name: string) => name,
      amount: (value: number) => String(value),
    },
    options: {
      categories: [
        { value: "1", label: "Entertainment" },
        { value: "2", label: "Groceries" },
      ],
      accounts: [],
      transactionTypes: [],
      currencies: [],
    },
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  for (const mock of [
    state.update,
    state.remove,
    state.reorder,
    state.exportRules,
  ])
    mock.mockReset();
});

const rule = (ruleKey: number, name: string, categoryId: number): Rule => ({
  ruleKey,
  name,
  active: true,
  match: "all",
  stopProcessing: false,
  position: ruleKey,
  ownerAppuserKey: 1,
  conditions: [
    {
      field: "description",
      operator: "contains",
      source: "cleaned",
      value: name.toUpperCase(),
    },
  ],
  actions: [{ type: "set_category", categoryId }],
});

const netflix = rule(1, "Netflix", 1);
const spotify = rule(2, "Spotify", 1);
const market = rule(3, "Market", 2);

function renderRules(rules: Rule[]) {
  state.rules = rules;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enRules }}
      >
        <Rules />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

test("lists the rules in run order with a one-line summary", async () => {
  renderRules([netflix, spotify, market]);

  await screen.findByText("Netflix");
  const items = screen.getAllByRole("listitem");
  assert.deepEqual(
    items.map((item) => item.textContent?.match(/Netflix|Spotify|Market/)?.[0]),
    ["Netflix", "Spotify", "Market"],
  );
  screen.getByText("Description contains NETFLIX, set category Entertainment");
});

test("moving a rule down sends the household's whole list in the new order", async () => {
  state.reorder.mockResolvedValue([spotify, netflix, market]);
  const user = userEvent.setup();
  renderRules([netflix, spotify, market]);

  await user.click(
    await screen.findByRole("button", { name: "Move Netflix down" }),
  );

  await waitFor(() =>
    assert.deepEqual(state.reorder.mock.calls[0], [[2, 1, 3]]),
  );
});

test("switching a rule off sends only its active flag", async () => {
  state.update.mockResolvedValue({ ...netflix, active: false });
  const user = userEvent.setup();
  renderRules([netflix, spotify]);

  await user.click(
    await screen.findByRole("switch", { name: "Netflix, active" }),
  );

  await waitFor(() =>
    assert.deepEqual(state.update.mock.calls[0], [
      { ruleKey: 1, active: false },
    ]),
  );
});

test("searching narrows the list and hides reordering, which needs the whole list", async () => {
  const user = userEvent.setup();
  renderRules([netflix, spotify, market]);

  await user.type(await screen.findByLabelText("Search rules"), "spot");

  assert.equal(screen.queryByText("Netflix"), null);
  screen.getByText("Spotify");
  assert.equal(screen.queryByRole("button", { name: /Move .* down/ }), null);
  screen.getByText(enRules.rules["order-filtered"]);
});

test("deletes a rule only after confirming", async () => {
  state.remove.mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderRules([netflix]);

  await user.click(
    await screen.findByRole("button", { name: "Delete Netflix" }),
  );
  assert.equal(state.remove.mock.calls.length, 0);
  await user.click(screen.getByRole("button", { name: enRules.rules.delete }));

  await waitFor(() => assert.deepEqual(state.remove.mock.calls[0], [1]));
});

test("exporting downloads the household's rules as a JSON file", async () => {
  state.exportRules.mockResolvedValue(
    new Blob(["{}"], { type: "application/json" }),
  );
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const create = vi.fn(() => "blob:rules");
  const revoke = vi.fn();
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    const user = userEvent.setup();
    renderRules([netflix]);

    await user.click(
      await screen.findByRole("button", {
        name: enRules.rules.export.action,
      }),
    );

    await waitFor(() =>
      assert.equal(state.exportRules.mock.calls.length, 1),
    );
    assert.equal(create.mock.calls.length, 1);
    assert.equal(click.mock.calls.length, 1);
    assert.equal(revoke.mock.calls[0]?.[0], "blob:rules");
  } finally {
    click.mockRestore();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  }
});

test("importing opens the import dialog", async () => {
  const user = userEvent.setup();
  renderRules([netflix]);

  await user.click(
    await screen.findByRole("button", { name: enRules.rules.import.action }),
  );

  await screen.findByRole("dialog");
  screen.getByText(enRules.rules.import.title);
});
