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
  preview: vi.fn(),
  put: vi.fn(async () => ({ status: 200 })),
  createImport: vi.fn(async () => ({ id: "import-1", status: "parsing" })),
  createPdfImport: vi.fn(async () => ({
    id: "pdf-1",
    status: "waiting_for_upload",
    upload: {
      key: "account-3-statement-1.pdf",
      url: "https://storage.test/pdf",
    },
  })),
  startRead: vi.fn(async () => ({ id: "pdf-1", status: "parsing" })),
  cancelImport: vi.fn(async () => ({})),
  toastError: vi.fn(),
  aiHidden: false,
  statementImport: null as null | {
    maxBytes: number;
    maxPages: number;
    providerKind: string;
  },
  provider: { kind: "anthropic", name: "Anthropic" } as {
    kind: string;
    name: string | null;
  } | null,
  providerEnabled: [] as boolean[],
}));

vi.mock("axios", () => ({ default: { put: mocks.put } }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("@/lib/api/account/useCreateAccountTransactionsCsvUrl", () => ({
  default: () => ({ isPending: false, mutate: mocks.presign }),
}));
vi.mock("@/lib/api/account/usePreviewAccountCsvImport", () => ({
  default: () => ({ isPending: false, mutateAsync: mocks.preview }),
}));
vi.mock("@/lib/api/transaction-import/useTransactionImport", () => ({
  useCancelTransactionImport: () => ({ mutateAsync: mocks.cancelImport }),
  useCreatePdfTransactionImport: () => ({
    isPending: false,
    mutateAsync: mocks.createPdfImport,
  }),
  useCreateTransactionImport: () => ({
    isPending: false,
    mutateAsync: mocks.createImport,
  }),
  useStartTransactionImportRead: () => ({ mutateAsync: mocks.startRead }),
}));
vi.mock("@/lib/api/user/useStatementImportProvider", () => ({
  default: (enabled: boolean) => {
    mocks.providerEnabled.push(enabled);
    return { data: enabled ? mocks.provider : undefined };
  },
}));
vi.mock("@/components/auth/EmailVerificationNotice", () => ({
  default: () => <div data-testid="email-verification-notice" />,
}));
vi.mock("./TransactionImportReview", () => ({
  default: ({ importId }: { importId: string }) => (
    <div data-testid="review">{importId}</div>
  ),
}));
vi.mock("@/lib/api/instance/useInstance", () => ({
  useFeature: () => true,
  useStatementImport: () => mocks.statementImport,
}));
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));
vi.mock("@/lib/api/user-preferences/useAiHidden", () => ({
  default: () => mocks.aiHidden,
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
  mocks.preview.mockReset();
  mocks.put.mockClear();
  mocks.createImport.mockClear();
  mocks.createPdfImport.mockClear();
  mocks.startRead.mockClear();
  mocks.cancelImport.mockClear();
  mocks.toastError.mockClear();
  mocks.aiHidden = false;
  mocks.statementImport = null;
  mocks.provider = { kind: "anthropic", name: "Anthropic" };
  mocks.providerEnabled.length = 0;
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

const MAPPING = {
  columns: { amount: 2, date: 0, description: 1 },
  dateFormat: "DMY",
  decimalSeparator: ",",
  headerRowIndex: 0,
  invertAmounts: false,
} as const;

/** The preview endpoint's answer for a file it read. */
function previewOf(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ambiguousDateFormat: false,
      firstDate: "2026-01-02",
      headers: ["Data", "Descrição", "Montante"],
      invalidRows: 0,
      lastDate: "2026-01-31",
      mapping: MAPPING,
      sample: [
        {
          amount: -12.4,
          currency: "EUR",
          date: "2026-01-02",
          description: "PINGO DOCE",
        },
      ],
      source: "columns",
      totalRows: 42,
      ...overrides,
    },
  };
}

async function pickFile(name: string) {
  const user = userEvent.setup();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input, "no file input");
  await user.upload(input, new File(["Data;Descrição;Montante\n"], name));
  return user;
}

test("a file from any bank is read as soon as it is picked, and is staged for review with the columns found", async () => {
  presignAnswers(false);
  mocks.preview.mockResolvedValue(previewOf());
  renderModal(unsupportedBankAccount);

  const user = await pickFile("extrato.csv");

  const preview = await screen.findByTestId("statement-preview");
  assert.ok(preview.textContent?.includes("42 transactions"));
  assert.ok(preview.textContent?.includes("PINGO DOCE"));
  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );

  await waitFor(() => assert.equal(mocks.createImport.mock.calls.length, 1));
  assert.deepEqual(mocks.createImport.mock.calls[0], [
    {
      accountId: "3",
      fileName: "extrato.csv",
      format: "statement",
      key: "account-3-upload.csv",
      mapping: MAPPING,
    },
  ]);
  // Nothing is imported yet: the dialog moves on to the review.
  assert.equal((await screen.findByTestId("review")).textContent, "import-1");
  assert.equal(mocks.toastError.mock.calls.length, 0);
});

test("a supported bank's own export is staged without columns", async () => {
  presignAnswers(true);
  mocks.preview.mockResolvedValue(
    previewOf({ bankName: "bcp", mapping: undefined, source: "bank" }),
  );
  renderModal(supportedBankAccount);

  const user = await pickFile("statement.xlsx");
  await screen.findByTestId("statement-preview");
  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );

  await waitFor(() => assert.equal(mocks.createImport.mock.calls.length, 1));
  assert.deepEqual(mocks.createImport.mock.calls[0], [
    {
      accountId: "3",
      fileName: "statement.xlsx",
      format: "statement",
      key: "account-3-upload.csv",
      mapping: undefined,
    },
  ]);
});

test("an OFX/QFX file skips the column preview and is staged as an OFX import", async () => {
  presignAnswers(false);
  renderModal(manualAccount);

  const user = await pickFile("statement.ofx");

  assert.equal(mocks.preview.mock.calls.length, 0);
  assert.ok(screen.getByText(messages["import-ofx-ready"]));
  assert.equal(
    (
      mocks.put.mock.calls[0] as unknown as
        [unknown, unknown, { headers?: Record<string, string> }] | undefined
    )?.[2]?.headers?.["Content-Type"],
    "application/x-ofx",
  );

  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );
  await waitFor(() => assert.equal(mocks.createImport.mock.calls.length, 1));
  assert.deepEqual(mocks.createImport.mock.calls[0], [
    {
      accountId: "3",
      fileName: "statement.ofx",
      format: "ofx",
      key: "account-3-upload.csv",
      mapping: undefined,
    },
  ]);
});

test("a QIF file skips the column preview and is staged as a QIF import", async () => {
  presignAnswers(false);
  renderModal(manualAccount);

  const user = await pickFile("statement.qif");

  assert.equal(mocks.preview.mock.calls.length, 0);
  assert.ok(screen.getByText(messages["import-qif-ready"]));
  assert.equal(
    (
      mocks.put.mock.calls[0] as unknown as
        [unknown, unknown, { headers?: Record<string, string> }] | undefined
    )?.[2]?.headers?.["Content-Type"],
    "application/x-qif",
  );

  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );
  await waitFor(() => assert.equal(mocks.createImport.mock.calls.length, 1));
  assert.deepEqual(mocks.createImport.mock.calls[0], [
    {
      accountId: "3",
      fileName: "statement.qif",
      format: "qif",
      key: "account-3-upload.csv",
      mapping: undefined,
    },
  ]);
});

test("Import from YNAB shows how to export the register, and stages the file as a YNAB import with its name", async () => {
  presignAnswers(false);
  renderModal(manualAccount);
  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: messages["import-ynab-entry"] }),
  );
  const guide = screen.getByTestId("ynab-export-guide");
  assert.ok(guide.textContent?.includes(messages["import-ynab-guide-unzip"]));

  await pickFile("My Budget as of 2026-02-04 - Register.csv");
  assert.equal(mocks.preview.mock.calls.length, 0, "no column preview");
  assert.ok(screen.getByText(messages["import-ynab-ready"]));

  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );
  await waitFor(() => assert.equal(mocks.createImport.mock.calls.length, 1));
  assert.deepEqual(mocks.createImport.mock.calls[0], [
    {
      accountId: "3",
      fileName: "My Budget as of 2026-02-04 - Register.csv",
      format: "ynab",
      key: "account-3-upload.csv",
      mapping: undefined,
    },
  ]);
});

test("going back from YNAB reads a CSV as a bank statement again", async () => {
  presignAnswers(false);
  mocks.preview.mockResolvedValue(previewOf());
  renderModal(manualAccount);
  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: messages["import-ynab-entry"] }),
  );
  await user.click(
    screen.getByRole("button", { name: messages["import-statement-back"] }),
  );
  assert.equal(screen.queryByTestId("ynab-export-guide"), null);

  await pickFile("extrato.csv");
  await screen.findByTestId("statement-preview");
  assert.equal(mocks.preview.mock.calls.length, 1);
});

test("Import from Actual Budget shows how to export the transactions, and stages the file as an Actual import with its name", async () => {
  presignAnswers(false);
  renderModal(manualAccount);
  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: messages["import-actual-entry"] }),
  );
  assert.ok(
    screen.getByRole("heading", { name: messages["import-actual-title"] }),
  );
  const guide = screen.getByTestId("actual-export-guide");
  assert.ok(
    guide.textContent?.includes(messages["import-actual-guide-export"]),
  );
  assert.equal(screen.queryByTestId("ynab-export-guide"), null);

  await pickFile("transactions.csv");
  assert.equal(mocks.preview.mock.calls.length, 0, "no column preview");
  assert.ok(screen.getByText(messages["import-actual-ready"]));

  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );
  await waitFor(() => assert.equal(mocks.createImport.mock.calls.length, 1));
  assert.deepEqual(mocks.createImport.mock.calls[0], [
    {
      accountId: "3",
      fileName: "transactions.csv",
      format: "actual",
      key: "account-3-upload.csv",
      mapping: undefined,
    },
  ]);
});

test("going back from Actual Budget reads a CSV as a bank statement again", async () => {
  presignAnswers(false);
  mocks.preview.mockResolvedValue(previewOf());
  renderModal(manualAccount);
  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: messages["import-actual-entry"] }),
  );
  await user.click(
    screen.getByRole("button", { name: messages["import-statement-back"] }),
  );
  assert.equal(screen.queryByTestId("actual-export-guide"), null);
  assert.ok(
    screen.getByRole("button", { name: messages["import-ynab-entry"] }),
  );

  await pickFile("extrato.csv");
  await screen.findByTestId("statement-preview");
  assert.equal(mocks.preview.mock.calls.length, 1);
});

test("a file whose columns could not be found cannot be imported until they are picked", async () => {
  presignAnswers(false);
  mocks.preview.mockResolvedValue(
    previewOf({
      mapping: { ...MAPPING, columns: { description: 1 } },
      sample: [],
      source: "none",
      totalRows: 0,
    }),
  );
  renderModal(manualAccount);

  await pickFile("export.csv");
  await screen.findByTestId("statement-preview");

  assert.ok(
    screen.getByText(messages["import-statement-source-none"]),
    "asks for the columns",
  );
  assert.equal(
    screen
      .getByRole("button", { name: messages["import-review-start"] })
      .hasAttribute("disabled"),
    true,
  );
});

test("picking another account uploads the file again for that account", async () => {
  presignAnswers(false);
  mocks.preview.mockResolvedValue(previewOf());
  renderModal(
    { ...unsupportedBankAccount, accountKey: 7, accountName: "1822" },
    { ...manualAccount, accountKey: 8, accountName: "Cash" },
  );

  const user = await pickFile("extrato.csv");
  await screen.findByTestId("statement-preview");
  await user.click(screen.getAllByRole("combobox")[0]);
  await user.click(await screen.findByRole("option", { name: "Cash" }));

  await waitFor(() => assert.equal(mocks.presign.mock.calls.length, 2));
  assert.deepEqual(mocks.presign.mock.calls[1][0], { accountId: "8" });
  await waitFor(() => assert.equal(mocks.preview.mock.calls.length, 2));
  assert.equal(mocks.preview.mock.calls[1][0].accountId, "8");
});

const STATEMENT_IMPORT = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 20,
  providerKind: "anthropic",
};

const pdfEntry = () =>
  screen.queryByRole("button", { name: messages["import-pdf-entry"] });

async function pickPdf(user: ReturnType<typeof userEvent.setup>, size = 2048) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input, "no file input");
  await user.upload(
    input,
    new File([new Uint8Array(size)], "September.pdf", {
      type: "application/pdf",
    }),
  );
}

test("PDF statement import is offered only when the server has a model for it and the person has not hidden AI", () => {
  renderModal(manualAccount);
  assert.equal(pdfEntry(), null, "no model on the server");
  cleanup();

  mocks.statementImport = STATEMENT_IMPORT;
  mocks.aiHidden = true;
  renderModal(manualAccount);
  assert.equal(pdfEntry(), null, "AI hidden");
  cleanup();

  mocks.aiHidden = false;
  renderModal(manualAccount);
  assert.ok(pdfEntry());
});

test("a PDF statement names the provider its pages go to, uploads only on import, and opens the review once the read starts", async () => {
  mocks.statementImport = STATEMENT_IMPORT;
  renderModal(manualAccount);
  const user = userEvent.setup();

  await user.click(pdfEntry()!);
  const consent = screen.getByTestId("pdf-statement-consent");
  assert.ok(consent.textContent?.includes("Anthropic"));
  assert.ok(
    screen.getByRole("heading", { name: messages["import-pdf-title"] }),
  );

  await pickPdf(user);
  assert.equal(mocks.presign.mock.calls.length, 0, "no CSV upload");
  assert.equal(mocks.createPdfImport.mock.calls.length, 0, "nothing spent yet");

  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );
  await waitFor(() => assert.ok(screen.getByTestId("review")));
  assert.deepEqual(mocks.createPdfImport.mock.calls[0], [
    { accountId: "3", contentLength: 2048, fileName: "September.pdf" },
  ]);
  const [url, , config] = mocks.put.mock.calls[0] as unknown as [
    string,
    File,
    { headers: Record<string, string> },
  ];
  assert.equal(url, "https://storage.test/pdf");
  assert.equal(config.headers["Content-Type"], "application/pdf");
  assert.deepEqual(mocks.startRead.mock.calls[0], ["pdf-1"]);
  assert.equal(screen.getByTestId("review").textContent, "pdf-1");
  assert.equal(mocks.createImport.mock.calls.length, 0);
});

test("a PDF statement the upload fails for closes its import and says so", async () => {
  mocks.statementImport = STATEMENT_IMPORT;
  mocks.put.mockRejectedValueOnce(new Error("network"));
  renderModal(manualAccount);
  const user = userEvent.setup();

  await user.click(pdfEntry()!);
  await pickPdf(user);
  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );
  await waitFor(() =>
    assert.ok(screen.getByText(messages["import-pdf-upload-failed"])),
  );
  assert.deepEqual(mocks.cancelImport.mock.calls[0], [
    { id: "pdf-1", input: undefined },
  ]);
  assert.equal(mocks.startRead.mock.calls.length, 0);
  assert.equal(screen.queryByTestId("review"), null);
});

test("a household that used today's statement imports is told when they come back", async () => {
  mocks.statementImport = STATEMENT_IMPORT;
  mocks.createPdfImport.mockRejectedValueOnce({
    response: { data: { code: "ai_allowance_exhausted" }, status: 403 },
  });
  renderModal(manualAccount);
  const user = userEvent.setup();

  await user.click(pdfEntry()!);
  await pickPdf(user);
  await user.click(
    screen.getByRole("button", { name: messages["import-review-start"] }),
  );
  await waitFor(() => assert.ok(screen.getByTestId("ai-allowance-notice")));
  assert.equal(mocks.put.mock.calls.length, 0);
});

test("an OpenAI-compatible provider is named generically, and the profile is read only once PDF import is chosen", async () => {
  mocks.statementImport = {
    ...STATEMENT_IMPORT,
    providerKind: "openai-compatible",
  };
  mocks.provider = { kind: "openai-compatible", name: null };
  renderModal(manualAccount);
  assert.ok(
    !mocks.providerEnabled.includes(true),
    "not read before PDF import is chosen",
  );

  await userEvent.setup().click(pdfEntry()!);
  const consent = screen.getByTestId("pdf-statement-consent");
  assert.ok(
    consent.textContent?.includes(messages["import-pdf-consent-configured"]),
  );
  assert.ok(mocks.providerEnabled.includes(true));
});
