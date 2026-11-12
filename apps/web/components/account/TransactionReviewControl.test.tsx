// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import enCommon from "../../messages/en/common.json";
import enTransactions from "../../messages/en/transactions.json";
import TransactionReviewControl, {
  type SelectAllMatching,
} from "./TransactionReviewControl";

const state = vi.hoisted(() => ({
  edit: vi.fn(),
  remove: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/api/account/useEditTransactions", () => ({
  default: () => ({ mutateAsync: state.edit }),
}));

vi.mock("@/lib/api/account/useDeleteTransactions", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    useDeleteTransactions: () => ({
      mutateAsync: state.remove,
      isPending: false,
    }),
  };
});

vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({ data: { categories: [] }, isLoading: false }),
}));

vi.mock("@/lib/api/tag/useTags", () => ({
  default: () => ({
    data: {
      tags: [
        { tagKey: 1, name: "Trip", color: "#ff8800" },
        { tagKey: 2, name: "Work", color: "#0088ff" },
      ],
    },
    isLoading: false,
  }),
}));

// The category picker has its own tests; here it only has to render.
vi.mock("@/components/CategorySelect", () => ({ default: () => null }));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: state.toast }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  state.edit.mockReset();
  state.remove.mockReset();
  state.toast.mockReset();
  state.toast.success.mockReset();
  state.toast.error.mockReset();
});

const row = (transactionKey: number, overrides: Partial<Transaction> = {}) =>
  ({
    transactionKey,
    reviewed: false,
    hidden: false,
    bankSynced: false,
    tags: [],
    splits: [],
    appuserTransactionCategories: [],
    ...overrides,
  }) as unknown as Transaction;

function renderControl(
  transactions: Transaction[],
  selectAllMatching?: SelectAllMatching,
) {
  const onResetSelection = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions }}
        timeZone="UTC"
      >
        <TransactionReviewControl
          transactions={transactions}
          onResetSelection={onResetSelection}
          selectAllMatching={selectAllMatching}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onResetSelection };
}

const matching = (
  overrides: Partial<SelectAllMatching> = {},
): SelectAllMatching => ({
  total: 240,
  filter: { fromDate: "2026-03-01T00:00:00.000Z", accountKeys: "7" },
  includesHidden: false,
  selected: false,
  onSelect: vi.fn(),
  ...overrides,
});

test("adds a tag to every selected row", async () => {
  const user = userEvent.setup();
  state.edit.mockResolvedValue(undefined);
  renderControl([row(11), row(12)]);

  await user.click(screen.getByRole("button", { name: "Tag" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Add the tag Work" }),
  );

  await waitFor(() => assert.equal(state.edit.mock.calls.length, 1));
  assert.deepEqual(state.edit.mock.calls[0]?.[0], {
    transactionIds: ["11", "12"],
    addTagIds: [2],
  });
});

test("offers to remove only the tags a selected row carries", async () => {
  const user = userEvent.setup();
  state.edit.mockResolvedValue(undefined);
  renderControl([
    row(11, { tags: [{ tagKey: 1, name: "Trip", color: "#ff8800" }] }),
    row(12),
  ]);

  await user.click(screen.getByRole("button", { name: "Tag" }));
  assert.equal(
    screen.queryByRole("menuitem", { name: "Remove the tag Work" }),
    null,
  );
  await user.click(
    await screen.findByRole("menuitem", { name: "Remove the tag Trip" }),
  );

  await waitFor(() => assert.equal(state.edit.mock.calls.length, 1));
  assert.deepEqual(state.edit.mock.calls[0]?.[0], {
    transactionIds: ["11", "12"],
    removeTagIds: [1],
  });
});

test("asks before deleting, with the count, and says the bank rows are skipped", async () => {
  const user = userEvent.setup();
  state.remove.mockResolvedValue({
    deletedTransactionIds: [11, 12],
    skipped: [{ reason: "bank_synced", transactionIds: [13] }],
  });
  renderControl([row(11), row(12), row(13, { bankSynced: true })]);

  await user.click(screen.getByRole("button", { name: "Delete" }));

  const dialog = await screen.findByRole("alertdialog");
  assert.ok(within(dialog).getByText("Delete 2 transactions?"));
  assert.ok(
    within(dialog).getByText(
      /1 of them came from your bank and will be skipped/,
    ),
  );
  assert.equal(state.remove.mock.calls.length, 0);

  await user.click(
    within(dialog).getByRole("button", { name: "Delete 2 transactions" }),
  );

  await waitFor(() => assert.equal(state.remove.mock.calls.length, 1));
  assert.deepEqual(state.remove.mock.calls[0]?.[0], {
    transactionIds: [11, 12, 13],
  });
  await waitFor(() =>
    assert.equal(
      state.toast.success.mock.calls[0]?.[0],
      "2 transactions deleted",
    ),
  );
  // The skipped bank rows come with an offer to hide them.
  const [message, options] = state.toast.mock.calls[0] ?? [];
  assert.equal(message, "1 bank transaction was not deleted");
  assert.equal(options.action.label, "Hide them");
  state.edit.mockResolvedValue(undefined);
  options.action.onClick();
  await waitFor(() =>
    assert.deepEqual(state.edit.mock.calls[0]?.[0], {
      transactionIds: [13],
      hidden: true,
    }),
  );
});

test("offers hiding instead of deleting when every selected row came from the bank", async () => {
  const user = userEvent.setup();
  state.edit.mockResolvedValue(undefined);
  renderControl([row(21, { bankSynced: true }), row(22, { bankSynced: true })]);

  await user.click(screen.getByRole("button", { name: "Delete" }));

  const dialog = await screen.findByRole("alertdialog");
  assert.ok(within(dialog).getByText("These transactions came from your bank"));
  assert.equal(within(dialog).queryByRole("button", { name: /^Delete/ }), null);
  await user.click(
    within(dialog).getByRole("button", {
      name: "Hide 2 bank transactions instead",
    }),
  );

  await waitFor(() =>
    assert.deepEqual(state.edit.mock.calls[0]?.[0], {
      transactionIds: [21, 22],
      hidden: true,
    }),
  );
  assert.equal(state.remove.mock.calls.length, 0);
});

test("offers to select every matching row once the whole page is selected", async () => {
  const user = userEvent.setup();
  const selectAll = matching();
  renderControl([row(11), row(12)], selectAll);

  assert.ok(screen.getByText("All 2 transactions on this page are selected."));
  await user.click(
    screen.getByRole("button", {
      name: "Select all 240 matching transactions",
    }),
  );

  assert.equal(
    (selectAll.onSelect as ReturnType<typeof vi.fn>).mock.calls.length,
    1,
  );
});

test("sends the list's filter, not the loaded ids, once every matching row is selected", async () => {
  const user = userEvent.setup();
  state.edit.mockResolvedValue(undefined);
  state.remove.mockResolvedValue({
    deletedTransactionIds: [1, 2, 3],
    skipped: [],
  });
  const selectAll = matching({ selected: true });
  renderControl([row(11), row(12)], selectAll);

  assert.ok(screen.getByText("All 240 matching transactions are selected"));
  await user.click(screen.getByRole("button", { name: "Hide" }));
  await waitFor(() => assert.equal(state.edit.mock.calls.length, 1));
  assert.deepEqual(state.edit.mock.calls[0]?.[0], {
    filter: selectAll.filter,
    hidden: true,
  });

  await user.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("alertdialog");
  assert.ok(within(dialog).getByText("Delete 240 transactions?"));
  assert.ok(
    within(dialog).getByText(
      /Transactions that came from your bank are skipped/,
    ),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Delete 240 transactions" }),
  );
  await waitFor(() =>
    assert.deepEqual(state.remove.mock.calls[0]?.[0], {
      filter: selectAll.filter,
    }),
  );
});

test("does not offer to select more matching rows than one request may change", () => {
  renderControl([row(11)], matching({ total: 5001 }));

  assert.equal(screen.queryByRole("button", { name: /Select all/ }), null);
  assert.ok(
    screen.getByText(
      "Narrow the filters to change more than 5,000 transactions at once.",
    ),
  );
});
