// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";

import enCommon from "../../messages/en/common.json";
import enTransactions from "../../messages/en/transactions.json";
import AccountTransactionDeleteModal from "./AccountTransactionDeleteModal";

const state = vi.hoisted(() => ({
  edit: vi.fn(),
  remove: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/account/useEditTransactions", () => ({
  default: () => ({ mutateAsync: state.edit, isPending: false }),
}));

vi.mock("@/lib/api/account/useDeleteTransactions", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    useDeleteTransaction: () => ({
      mutateAsync: state.remove,
      isPending: false,
    }),
  };
});

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: state.toastSuccess, error: state.toastError },
}));

afterEach(() => {
  cleanup();
  state.edit.mockReset();
  state.remove.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
});

function renderModal(overrides: Partial<Transaction> = {}) {
  const closeModal = vi.fn();
  const transaction = {
    transactionKey: 31,
    hidden: false,
    bankSynced: false,
    ...overrides,
  } as unknown as Transaction;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions }}
        timeZone="UTC"
      >
        <AccountTransactionDeleteModal
          isOpen
          closeModal={closeModal}
          transaction={transaction}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { closeModal };
}

test("deletes a manual transaction once confirmed", async () => {
  const user = userEvent.setup();
  state.remove.mockResolvedValue(undefined);
  const { closeModal } = renderModal();

  await user.click(
    screen.getByRole("button", { name: "Delete 1 transaction" }),
  );

  await waitFor(() => assert.deepEqual(state.remove.mock.calls[0], [31]));
  await waitFor(() => assert.equal(closeModal.mock.calls.length, 1));
  assert.equal(state.toastSuccess.mock.calls[0]?.[0], "1 transaction deleted");
});

test("explains that a bank transaction cannot be deleted and hides it instead", async () => {
  const user = userEvent.setup();
  state.edit.mockResolvedValue(undefined);
  renderModal({ bankSynced: true });

  assert.ok(screen.getByText("This transaction came from your bank"));
  assert.equal(screen.queryByRole("button", { name: /^Delete/ }), null);
  await user.click(screen.getByRole("button", { name: "Hide it instead" }));

  await waitFor(() =>
    assert.deepEqual(state.edit.mock.calls[0]?.[0], {
      transactionIds: [31],
      hidden: true,
    }),
  );
  assert.equal(state.remove.mock.calls.length, 0);
});
