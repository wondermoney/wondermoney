// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { Account } from "@/lib/api/account/useAccounts";

import messages from "../../messages/en/common.json";
import AccountTransactionImportModal from "./AccountTransactionImportModal";

const mocks = vi.hoisted(() => ({
  presign: vi.fn(),
  put: vi.fn(async () => ({ status: 200 })),
  startImport: vi.fn(async () => ({
    data: { correlationId: "csv-1", status: "queued" },
  })),
  toastError: vi.fn(),
}));

vi.mock("axios", () => ({ default: { put: mocks.put } }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("@/lib/api/account/useCreateAccountTransactionsCsvUrl", () => ({
  default: () => ({ isPending: false, mutate: mocks.presign }),
}));
vi.mock("@/lib/api/account/useStartAccountCsvImport", () => ({
  default: () => ({ isPending: false, mutateAsync: mocks.startImport }),
}));
vi.mock("@/lib/api/background-operation/useBackgroundOperation", () => ({
  useBackgroundOperation: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/configs/useConfigs", () => ({
  default: () => ({
    data: {
      transactionTypes: [
        { transactionTypeKey: 4, name: "PAYMENT" },
        { transactionTypeKey: 9, name: "DEPOSIT" },
      ],
    },
  }),
}));
vi.mock("@/lib/api/instance/useInstance", () => ({
  useFeature: () => true,
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  URL.createObjectURL ??= () => "blob:preview";
  URL.revokeObjectURL ??= () => {};
});
beforeEach(() => {
  mocks.presign.mockReset();
  mocks.put.mockClear();
  mocks.startImport.mockClear();
  mocks.toastError.mockClear();
});
afterEach(() => cleanup());

function account(
  overrides: Partial<Account> & Pick<Account, "csvImportFormat">,
): Account {
  return {
    accountKey: 3,
    accountName: "Everyday",
    accountFinancialInstitutionKey: null,
    balance: 0,
    currencyKey: { code: "EUR" },
    appuserCurrencyBalance: 0,
    accountOwnerAppuserKey: { currencyKey: { code: "EUR" } },
    refreshedAt: null,
    source: "manual",
    isPrivate: false,
    isOwnedByViewer: true,
    ownerFirstName: null,
    availableBalance: 0,
    appuserCurrencyAvailableBalance: 0,
    syncStatus: null,
    ...overrides,
  };
}

const manualAccount = account({ csvImportFormat: "generic" });
const unsupportedBankAccount = account({
  accountFinancialInstitutionKey: { displayName: "1822direkt", logoUrl: null },
  csvImportFormat: "generic",
});
const supportedBankAccount = account({
  accountFinancialInstitutionKey: {
    displayName: "Millennium BCP",
    logoUrl: null,
  },
  csvImportFormat: "bank",
});

function renderModal(...accounts: Account[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <AccountTransactionImportModal
          accounts={accounts}
          isOpen
          setOpen={() => {}}
          trigger={null}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The presign endpoint as the API answers it for the account's format. */
function presignAnswers(isSupportedBank: boolean) {
  mocks.presign.mockImplementation(
    (
      _input: unknown,
      callbacks: { onSuccess: (response: unknown) => Promise<void> },
    ) =>
      void callbacks.onSuccess({
        data: {
          csvImportFormat: isSupportedBank ? "bank" : "generic",
          isSupportedBank,
          key: "account-3-upload.csv",
          presignedUrl: "https://storage.test/upload",
        },
      }),
  );
}

async function importFile(name: string) {
  const user = userEvent.setup();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input, "no file input");
  await user.upload(
    input,
    new File(["date,amount\n"], name, { type: "text/csv" }),
  );
  await user.click(screen.getByRole("button", { name: messages.import }));
}

test.each([
  ["a manual account with no bank", manualAccount],
  ["an account at a bank without a statement parser", unsupportedBankAccount],
])(
  "%s is offered the generic CSV format and its import starts",
  async (_kind, selected) => {
    presignAnswers(false);
    renderModal(selected);

    const format = screen.getByTestId("account-import-generic-format");
    assert.ok(format.textContent?.includes("transactionTypeKey"));
    assert.ok(
      screen.getByRole("button", {
        name: messages["import-transactions-generic-download-template"],
      }),
    );

    await importFile("transactions.csv");

    await waitFor(() => assert.equal(mocks.startImport.mock.calls.length, 1));
    assert.equal(mocks.put.mock.calls.length, 1);
    assert.deepEqual(mocks.startImport.mock.calls[0], [
      { accountId: "3", key: "account-3-upload.csv" },
    ]);
    assert.equal(mocks.toastError.mock.calls.length, 0);
  },
);

test("a supported bank's account is asked for the bank's own export and its import starts", async () => {
  presignAnswers(true);
  renderModal(supportedBankAccount);

  assert.ok(
    screen
      .getByTestId("account-import-bank-format")
      .textContent?.includes("Millennium BCP"),
  );
  assert.equal(screen.queryByTestId("account-import-generic-format"), null);

  await importFile("statement.csv");

  await waitFor(() => assert.equal(mocks.startImport.mock.calls.length, 1));
  assert.equal(mocks.toastError.mock.calls.length, 0);
});

test("picking another account in the dialog switches to that account's format and imports into it", async () => {
  presignAnswers(true);
  const user = userEvent.setup();
  renderModal(
    { ...unsupportedBankAccount, accountKey: 7, accountName: "1822" },
    { ...supportedBankAccount, accountKey: 8, accountName: "BCP" },
  );
  assert.ok(screen.getByTestId("account-import-generic-format"));

  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "BCP" }));

  await waitFor(() =>
    assert.ok(screen.getByTestId("account-import-bank-format")),
  );
  assert.equal(screen.queryByTestId("account-import-generic-format"), null);

  await importFile("statement.csv");
  await waitFor(() => assert.equal(mocks.startImport.mock.calls.length, 1));
  assert.deepEqual(mocks.startImport.mock.calls[0], [
    { accountId: "8", key: "account-3-upload.csv" },
  ]);
});
