// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type {
  TransactionImportSession,
  TransactionImportView,
} from "@/lib/api/transaction-import/useTransactionImport";

import messages from "../../messages/en/common.json";
import TransactionImportReview from "./TransactionImportReview";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(async () => ({})),
  commit: vi.fn(async () => ({})),
  decide: vi.fn(async () => ({})),
  map: vi.fn(async () => ({})),
  parse: vi.fn(async () => ({})),
  view: { current: undefined as TransactionImportView | undefined },
  queries: [] as unknown[],
}));

vi.mock("@/lib/api/transaction-import/useTransactionImport", () => {
  const mutation = (fn: unknown) => () => ({
    isPending: false,
    mutateAsync: fn,
  });
  return {
    FINISHED_IMPORT_STATUSES: new Set([
      "succeeded",
      "partial",
      "failed",
      "cancelled",
      "expired",
    ]),
    useCancelTransactionImport: mutation(mocks.cancel),
    useCommitTransactionImport: mutation(mocks.commit),
    useDecideTransactionImportRows: mutation(mocks.decide),
    useMapTransactionImportAccounts: mutation(mocks.map),
    useParseTransactionImport: mutation(mocks.parse),
    useTransactionImport: (_id: string, query: unknown) => {
      mocks.queries.push(query);
      return { data: mocks.view.current };
    },
  };
});
vi.mock("@/lib/api/useRateLimitToast", () => ({
  useRateLimitToast: () => () => false,
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  for (const fn of [mocks.cancel, mocks.commit, mocks.decide, mocks.map, mocks.parse])
    fn.mockClear();
  mocks.queries.length = 0;
});
afterEach(() => cleanup());

function session(
  overrides: Partial<TransactionImportSession> = {},
): TransactionImportSession {
  return {
    accountId: 3,
    accountMapping: {},
    canCommit: true,
    canRetry: false,
    committedAt: null,
    correlationId: "op-1",
    counts: {
      duplicate: 1,
      failed: 0,
      imported: 0,
      invalid: 1,
      new: 2,
      possible_duplicate: 0,
      skipped: 0,
    },
    createdAt: "2026-11-09T10:00:00Z",
    decisions: { import: 2, skip: 1 },
    detailsDeletedAt: null,
    errorCode: null,
    expiresAt: "2026-11-16T10:00:00Z",
    format: "statement",
    id: "import-1",
    sourceAccounts: [],
    status: "ready",
    upload: null,
    warnings: [],
    ...overrides,
  };
}

const rows: TransactionImportView["rows"] = {
  items: [
    {
      decision: "import",
      error: null,
      id: 11,
      matchedTransaction: null,
      normalized: {
        amount: -42.5,
        currency: "EUR",
        date: "2026-09-02T00:00:00.000Z",
        description: "CONTINENTE",
        merchant: "CONTINENTE",
      },
      sourceRow: 4,
      status: "new",
      targetAccountId: 3,
    },
    {
      decision: "skip",
      error: null,
      id: 12,
      matchedTransaction: {
        amount: 1500,
        date: "2026-09-05T00:00:00.000Z",
        description: "SALARIO",
        id: 90,
      },
      normalized: {
        amount: 1500,
        currency: "EUR",
        date: "2026-09-05T00:00:00.000Z",
        description: "SALARIO",
        merchant: "SALARIO",
      },
      sourceRow: 5,
      status: "duplicate",
      targetAccountId: 3,
    },
    {
      decision: null,
      error: "Unreadable date",
      id: 13,
      matchedTransaction: null,
      normalized: null,
      sourceRow: 6,
      status: "invalid",
      targetAccountId: 3,
    },
  ],
  page: 1,
  pageSize: 50,
  total: 3,
};

function renderReview(view: TransactionImportView, onFinished = vi.fn()) {
  mocks.view.current = view;
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TransactionImportReview
        accounts={[]}
        importId="import-1"
        onCancelled={vi.fn()}
        onFinished={onFinished}
      />
    </NextIntlClientProvider>,
  );
  return onFinished;
}

test("lists the rows with their status, and only readable rows can be included or skipped", async () => {
  renderReview({ rows, session: session() });
  const user = userEvent.setup();

  const review = screen.getByTestId("transaction-import-review");
  assert.ok(review.textContent?.includes("CONTINENTE"));
  assert.ok(
    review.textContent?.includes(messages["import-review-status-duplicate"]),
  );
  assert.ok(review.textContent?.includes("Unreadable date"));
  assert.equal(
    screen.getAllByRole("checkbox").length,
    2,
    "no checkbox on the unreadable row",
  );

  await user.click(screen.getByRole("checkbox", { name: "Import row 4" }));
  await waitFor(() => assert.equal(mocks.decide.mock.calls.length, 1));
  assert.deepEqual(mocks.decide.mock.calls[0], [
    { id: "import-1", input: { decision: "skip", rowIds: [11] } },
  ]);
});

test("filters by status and decides every row of it at once", async () => {
  renderReview({ rows, session: session() });
  const user = userEvent.setup();

  await user.click(
    screen.getByRole("button", { name: "Already in the account (1)" }),
  );
  assert.deepEqual(mocks.queries.at(-1), {
    page: 1,
    pageSize: 50,
    status: "duplicate",
  });
  await user.click(
    screen.getByRole("button", { name: messages["import-review-include-all"] }),
  );
  await waitFor(() => assert.equal(mocks.decide.mock.calls.length, 1));
  assert.deepEqual(mocks.decide.mock.calls[0], [
    { id: "import-1", input: { decision: "import", status: "duplicate" } },
  ]);
});

test("commits the rows decided import", async () => {
  renderReview({ rows, session: session() });
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Import 2 transactions" }),
  );
  await waitFor(() => assert.equal(mocks.commit.mock.calls.length, 1));
});

test("cannot commit until each account in the file has an account", () => {
  renderReview({
    rows,
    session: session({
      canCommit: false,
      sourceAccounts: [{ label: "Card", rowCount: 2 }],
      status: "needs_mapping",
    }),
  });
  assert.ok(
    screen.getByText(messages["import-review-mapping-title"], {
      selector: "p",
    }),
  );
  assert.equal(
    screen
      .getByRole("button", { name: "Import 2 transactions" })
      .hasAttribute("disabled"),
    true,
  );
  assert.equal(
    screen
      .getByRole("button", { name: messages["import-review-mapping-save"] })
      .hasAttribute("disabled"),
    true,
  );
});

test("asks for the date order of a QIF file whose dates are all ambiguous", async () => {
  renderReview({
    rows,
    session: session({
      format: "qif",
      warnings: [{ code: "date_order_ambiguous", detail: "day-first" }],
    }),
  });
  const user = userEvent.setup();

  assert.ok(
    screen.getByText(messages["import-review-date-order-title"], {
      selector: "p",
    }),
  );
  await user.click(
    screen.getByRole("button", {
      name: messages["import-statement-date-mdy"],
    }),
  );
  await waitFor(() => assert.equal(mocks.parse.mock.calls.length, 1));
  assert.deepEqual(mocks.parse.mock.calls[0], [
    { id: "import-1", input: { dateOrder: "month-first" } },
  ]);
});

test("offers to carry on a commit whose job stopped", async () => {
  renderReview({
    rows,
    session: session({ canRetry: true, status: "importing" }),
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: messages.retry }));
  await waitFor(() => assert.equal(mocks.commit.mock.calls.length, 1));
});

test("reports a finished import once", () => {
  const onFinished = renderReview({
    rows,
    session: session({
      counts: {
        duplicate: 0,
        failed: 0,
        imported: 2,
        invalid: 1,
        new: 0,
        possible_duplicate: 0,
        skipped: 1,
      },
      status: "succeeded",
    }),
  });
  assert.equal(onFinished.mock.calls.length, 1);
  assert.ok(
    screen.getByRole("status").textContent?.includes("2 transactions imported"),
  );
});

test("says an old import's details are no longer kept, and still shows its summary", () => {
  const counts = {
    duplicate: 0,
    failed: 0,
    imported: 2,
    invalid: 0,
    new: 0,
    possible_duplicate: 0,
    skipped: 1,
  };
  renderReview({
    rows: { items: [], page: 1, pageSize: 50, total: 0 },
    session: session({
      committedAt: "2026-11-01T10:00:00Z",
      counts,
      decisions: { import: 0, skip: 0 },
      detailsDeletedAt: "2026-11-09T03:30:00Z",
      status: "succeeded",
    }),
  });
  const status = screen.getByRole("status");
  assert.ok(status.textContent?.includes("2 transactions imported"));
  assert.ok(
    status.textContent?.includes(messages["import-review-details-deleted"]),
  );
});

test("a recent import does not say its details are gone", () => {
  renderReview({ rows, session: session({ status: "succeeded" }) });
  assert.equal(
    screen
      .getByRole("status")
      .textContent?.includes(messages["import-review-details-deleted"]),
    false,
  );
});
