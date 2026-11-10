// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enCommon from "../../messages/en/common.json";
import { AccountRecalculateDialog } from "./AccountRecalculateDialog";

const state = vi.hoisted(() => ({
  start: vi.fn(),
  operation: null as null | {
    status: string;
    progress: Record<string, unknown> | null;
  },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api/account/useRecalculateAccount", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    useRecalculateAccount: () => ({
      mutateAsync: state.start,
      isPending: false,
    }),
  };
});

vi.mock("@/lib/api/background-operation/useBackgroundOperation", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  // Polls the test's state, as the real hook polls the API.
  return {
    useBackgroundOperation: (id?: string) =>
      useQuery({
        queryKey: ["operation", id],
        queryFn: () => state.operation,
        enabled: !!id,
        refetchInterval: 20,
      }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: state.toastSuccess,
    error: state.toastError,
    info: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  state.start.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
  state.operation = null;
});

function renderDialog() {
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={enCommon} timeZone="UTC">
        <AccountRecalculateDialog
          accountKey={7}
          accountName="Wallet"
          onClose={onClose}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

const result = (rowsChanged: number) => ({
  accountKey: 7,
  amountsReconverted: 0,
  appuserCurrency: "EUR",
  appuserCurrencyBalanceAfter: 140,
  appuserCurrencyBalanceBefore: 500,
  balanceAfter: 140,
  balanceBefore: 500,
  currency: "EUR",
  rowsChanged,
  rowsScanned: 3,
});

test("starts on confirmation, follows the run and reports what it corrected", async () => {
  state.start.mockResolvedValue("account.recalculate:1");
  const { onClose } = renderDialog();

  await userEvent.click(screen.getByRole("button", { name: "Recalculate" }));
  assert.deepEqual(state.start.mock.calls[0], [7]);

  state.operation = { status: "running", progress: null };
  await screen.findByText("Recalculating balances…");

  state.operation = { status: "succeeded", progress: result(2) };
  await waitFor(() => assert.equal(onClose.mock.calls.length, 1));
  const [message, options] = state.toastSuccess.mock.calls[0] as [
    string,
    { description?: string },
  ];
  assert.equal(message, "Balances recalculated: 2 transactions corrected");
  assert.match(options.description ?? "", /500.*140/);
});

test("says so when the balances were already right", async () => {
  state.start.mockResolvedValue("account.recalculate:1");
  renderDialog();

  await userEvent.click(screen.getByRole("button", { name: "Recalculate" }));
  state.operation = { status: "succeeded", progress: result(0) };

  await waitFor(() =>
    assert.deepEqual(state.toastSuccess.mock.calls[0], [
      "Balances checked: they were already correct.",
    ]),
  );
});

test("explains a start refused for coming too soon", async () => {
  state.start.mockRejectedValue({
    response: {
      status: 429,
      data: { code: "account_recalculation_too_soon" },
    },
  });
  const { onClose } = renderDialog();

  await userEvent.click(screen.getByRole("button", { name: "Recalculate" }));

  await waitFor(() => assert.equal(onClose.mock.calls.length, 1));
  assert.deepEqual(state.toastError.mock.calls[0], [
    "This account was recalculated less than a minute ago. Try again shortly.",
  ]);
});

test("reports a failed run", async () => {
  state.start.mockResolvedValue("account.recalculate:1");
  renderDialog();

  await userEvent.click(screen.getByRole("button", { name: "Recalculate" }));
  state.operation = { status: "failed", progress: null };

  await waitFor(() =>
    assert.deepEqual(state.toastError.mock.calls[0], [
      "The balances could not be recalculated. Try again in a few minutes.",
    ]),
  );
});
