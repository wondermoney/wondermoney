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
import { SaveTransactionAsTemplateDialog } from "./SaveTransactionAsTemplateDialog";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/transaction-template/useTransactionTemplates", () => ({
  invalidateTransactionTemplates: state.invalidate,
  useCreateTransactionTemplate: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: state.toastError, success: state.toastSuccess },
}));

afterEach(() => {
  cleanup();
  state.create.mockReset();
  state.invalidate.mockReset();
  state.toastError.mockReset();
  state.toastSuccess.mockReset();
});

const transaction = {
  accountKey: { accountKey: 1, accountName: "Wallet" },
  description: "Cafe",
  settlementAmount: -3.5,
  settlementCurrencyKey: { code: "EUR" },
  transactionKey: 42,
  transactionMerchantKey: { name: "Corner shop" },
} as unknown as Transaction;

function renderDialog() {
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions }}
        timeZone="UTC"
      >
        <SaveTransactionAsTemplateDialog
          transaction={transaction}
          open
          onOpenChange={onOpenChange}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

test("saves the transaction as a named template", async () => {
  const user = userEvent.setup();
  state.create.mockResolvedValue({ transactionTemplateKey: 1 });
  const { onOpenChange } = renderDialog();

  const name = screen.getByLabelText("Name");
  assert.equal((name as HTMLInputElement).value, "Corner shop");
  await user.clear(name);
  await user.type(name, "Morning coffee");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    assert.deepEqual(state.create.mock.calls[0], [
      { fromTransactionId: 42, name: "Morning coffee" },
    ]),
  );
  assert.equal(state.invalidate.mock.calls.length, 1);
  assert.equal(state.toastSuccess.mock.calls.length, 1);
  assert.deepEqual(onOpenChange.mock.calls[0], [false]);
});

test("refuses a blank name without calling the API", async () => {
  const user = userEvent.setup();
  renderDialog();

  await user.clear(screen.getByLabelText("Name"));
  await user.click(screen.getByRole("button", { name: "Save" }));

  assert.equal(state.create.mock.calls.length, 0);
  assert.equal(
    screen.getByRole("alert").textContent,
    "Give the template a name.",
  );
});
