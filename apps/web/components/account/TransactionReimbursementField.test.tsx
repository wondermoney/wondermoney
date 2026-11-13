// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import type {
  LinkedTransaction,
  ReimbursementLink,
  ReimbursementSuggestion,
  TransactionReimbursements,
} from "@/lib/api/account/useTransactionReimbursements";
import type { Transaction } from "@/lib/api/account/useTransactions";

import enCommon from "../../messages/en/common.json";
import enTransactions from "../../messages/en/transactions.json";
import { TransactionReimbursementField } from "./TransactionReimbursementField";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/lib/api/api", () => ({ default: apiMock }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

afterEach(cleanup);

const side = (
  transactionKey: number,
  settlementAmount: number,
  overrides: Partial<LinkedTransaction> = {},
): LinkedTransaction => ({
  transactionKey,
  accountKey: 1,
  accountName: "Current account",
  description: `Transaction ${transactionKey}`,
  merchantName: null,
  transactionDate: "2026-10-01T00:00:00.000Z",
  settlementAmount,
  currencyCode: "EUR",
  ...overrides,
});

const shoes = side(1, -50, { merchantName: "Shoe shop" });
const refund = side(2, 20, { merchantName: "Shoe shop refund" });

const link = (
  overrides: Partial<ReimbursementLink> = {},
): ReimbursementLink => ({
  transactionReimbursementKey: 9,
  amount: 20,
  currencyCode: "EUR",
  createdAt: "2026-10-02T00:00:00.000Z",
  expense: shoes,
  reimbursement: refund,
  ...overrides,
});

const suggestion = (
  overrides: Partial<ReimbursementSuggestion> = {},
): ReimbursementSuggestion => ({
  ...shoes,
  remainingAmount: 50,
  reason: "merchant",
  ...overrides,
});

const row = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    transactionKey: 2,
    settlementAmount: 20,
    settlementCurrencyKey: { code: "EUR" },
    appuserSettlementAmount: 20,
    appuserCurrencyKey: { code: "EUR" },
    appuserTransactionCategories: [],
    transactionTypeKey: { name: "INCOME" },
    reimbursements: [],
    ...overrides,
  }) as Transaction;

/** What the API answers, by route. */
let links: TransactionReimbursements;
let suggestions: ReimbursementSuggestion[];

beforeEach(() => {
  vi.clearAllMocks();
  links = {
    role: "reimbursement",
    currencyCode: "EUR",
    linkedAmount: 0,
    remainingAmount: 20,
    links: [],
  };
  suggestions = [suggestion()];
  apiMock.get.mockImplementation(async (url: string) => {
    if (url.endsWith("/reimbursements/suggestions")) {
      return { data: { suggestions } };
    }
    if (url.endsWith("/reimbursements")) return { data: links };
    throw new Error(`unexpected GET ${url}`);
  });
});

function renderField(transaction = row()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions }}
      >
        <TransactionReimbursementField transaction={transaction} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const amountField = () =>
  screen.getByRole("textbox", { name: "Amount to link" }) as HTMLInputElement;

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  const mark = await screen.findByRole("button", {
    name: "Mark as reimbursement",
  });
  await waitFor(() =>
    assert.equal((mark as HTMLButtonElement).disabled, false),
  );
  await user.click(mark);
}

test("marks money in as the reimbursement of a suggested expense", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { link: link() } });
  renderField();

  await openPicker(user);

  // Same currency only, said up front; the merchant match is the reason it is suggested.
  assert.ok(screen.getByText("Only expenses in EUR can be linked for now."));
  const candidate = await screen.findByRole("button", { name: /Shoe shop/ });
  assert.match(candidate.textContent ?? "", /Same merchant/);
  assert.match(candidate.textContent ?? "", /Current account/);

  await user.click(candidate);
  assert.equal(candidate.getAttribute("aria-pressed"), "true");
  // The smaller of what is left on each: this 20 against a 50 expense.
  assert.equal(amountField().value, "20");

  await user.click(screen.getByRole("button", { name: "Link" }));

  await waitFor(() => assert.equal(apiMock.post.mock.calls.length, 1));
  assert.deepEqual(apiMock.post.mock.calls[0], [
    "/v1/account/transaction/2/reimbursements",
    { expenseTransactionId: 1, amount: 20 },
  ]);
  await waitFor(() =>
    assert.deepEqual(toastMock.success.mock.calls[0], [
      "Linked as a reimbursement",
    ]),
  );
  // The picker closes; the links are read again.
  await waitFor(() =>
    assert.equal(screen.queryByRole("button", { name: "Link" }), null),
  );
  assert.ok(
    apiMock.get.mock.calls.filter(([url]) =>
      String(url).endsWith("/transaction/2/reimbursements"),
    ).length >= 2,
  );
});

test("the amount starts at what the expense has left, and can be lowered", async () => {
  const user = userEvent.setup();
  links = { ...links, remainingAmount: 50 };
  suggestions = [suggestion({ remainingAmount: 15.5, reason: "amount" })];
  apiMock.post.mockResolvedValue({ data: { link: link() } });
  renderField(row({ settlementAmount: 50 }));

  await openPicker(user);
  const candidate = await screen.findByRole("button", { name: /Shoe shop/ });
  // Already partly reimbursed: what is left is shown, and no merchant hint.
  assert.match(candidate.textContent ?? "", /Left to link/);
  assert.doesNotMatch(candidate.textContent ?? "", /Same merchant/);
  await user.click(candidate);
  assert.equal(amountField().value, "15.5");

  await user.clear(amountField());
  await user.type(amountField(), "10");
  await user.click(screen.getByRole("button", { name: "Link" }));

  await waitFor(() =>
    assert.deepEqual(apiMock.post.mock.calls[0]?.[1], {
      expenseTransactionId: 1,
      amount: 10,
    }),
  );
});

test("an amount above what is left is refused before any request", async () => {
  const user = userEvent.setup();
  renderField();

  await openPicker(user);
  await user.click(await screen.findByRole("button", { name: /Shoe shop/ }));
  await user.clear(amountField());
  await user.type(amountField(), "25");
  await user.click(screen.getByRole("button", { name: "Link" }));

  assert.ok(screen.getByText("That's more than is left to link."));
  assert.equal(amountField().getAttribute("aria-invalid"), "true");
  assert.equal(apiMock.post.mock.calls.length, 0);
});

test("a currency mismatch from the API is explained", async () => {
  const user = userEvent.setup();
  apiMock.post.mockRejectedValue({
    response: {
      status: 400,
      data: { code: "reimbursement_currency_mismatch", message: "nope" },
    },
  });
  renderField();

  await openPicker(user);
  await user.click(await screen.findByRole("button", { name: /Shoe shop/ }));
  await user.click(screen.getByRole("button", { name: "Link" }));

  const alert = await screen.findByRole("alert");
  assert.equal(
    alert.textContent,
    "These transactions are in different currencies. Only transactions in the same currency can be linked for now.",
  );
  // The picker stays open to try another expense.
  assert.ok(screen.getByRole("button", { name: "Link" }));
});

test("an existing link is refused with its own message", async () => {
  const user = userEvent.setup();
  apiMock.post.mockRejectedValue({
    response: { status: 409, data: { code: "reimbursement_link_exists" } },
  });
  renderField();

  await openPicker(user);
  await user.click(await screen.findByRole("button", { name: /Shoe shop/ }));
  await user.click(screen.getByRole("button", { name: "Link" }));

  assert.match(
    (await screen.findByRole("alert")).textContent ?? "",
    /already linked/,
  );
});

test("searching asks the API for the text", async () => {
  const user = userEvent.setup();
  renderField();

  await openPicker(user);
  await screen.findByRole("button", { name: /Shoe shop/ });
  suggestions = [];
  await user.type(
    screen.getByRole("searchbox", { name: "Search transactions" }),
    "boots",
  );

  await screen.findByText("Nothing matches “boots”.");
  const searched = apiMock.get.mock.calls.find(
    ([url, config]) =>
      String(url).endsWith("/transaction/2/reimbursements/suggestions") &&
      config?.params?.search === "boots",
  );
  assert.ok(searched);
});

test("money in lists what it reimburses, and unlinks it", async () => {
  const user = userEvent.setup();
  links = {
    ...links,
    linkedAmount: 20,
    remainingAmount: 0,
    links: [link()],
  };
  apiMock.delete.mockResolvedValue({
    data: { transactionReimbursementKey: 9 },
  });
  renderField();

  assert.ok(await screen.findByText("Reimburses"));
  assert.ok(screen.getByText("Shoe shop"));
  assert.ok(screen.getByText("All of this is linked to expenses."));
  // Nothing is left to link, so there is no picker to open.
  assert.equal(
    screen.queryByRole("button", { name: "Mark as reimbursement" }),
    null,
  );

  await user.click(screen.getByRole("button", { name: "Unlink Shoe shop" }));

  await waitFor(() =>
    assert.deepEqual(apiMock.delete.mock.calls[0], [
      "/v1/account/transaction/2/reimbursements/9",
    ]),
  );
  await waitFor(() =>
    assert.deepEqual(toastMock.success.mock.calls[0], ["Link removed"]),
  );
});

test("an expense shows what reimbursed it and its net spending", async () => {
  const user = userEvent.setup();
  links = {
    role: "expense",
    currencyCode: "EUR",
    linkedAmount: 20,
    remainingAmount: 30,
    links: [link()],
  };
  apiMock.delete.mockResolvedValue({
    data: { transactionReimbursementKey: 9 },
  });
  renderField(row({ transactionKey: 1, settlementAmount: -50 }));

  assert.ok(await screen.findByText("Reimbursed by"));
  assert.ok(screen.getByText("Shoe shop refund"));
  const net = screen.getByText("Net spending").parentElement!;
  assert.match(net.textContent ?? "", /30\.00/);
  // From this side the picker looks for money in.
  await user.click(
    screen.getByRole("button", { name: "Link a reimbursement" }),
  );
  assert.ok(
    screen.getByText(
      "Only incoming transactions in EUR can be linked for now.",
    ),
  );

  await user.click(
    screen.getByRole("button", { name: "Unlink Shoe shop refund" }),
  );
  await waitFor(() =>
    assert.deepEqual(apiMock.delete.mock.calls[0], [
      "/v1/account/transaction/1/reimbursements/9",
    ]),
  );
});

test("an expense links the money in it chooses as its reimbursement", async () => {
  const user = userEvent.setup();
  links = { ...links, role: "expense", remainingAmount: 50 };
  suggestions = [{ ...refund, remainingAmount: 20, reason: "amount" }];
  apiMock.post.mockResolvedValue({ data: { link: link() } });
  renderField(row({ transactionKey: 1, settlementAmount: -50 }));

  await user.click(
    await screen.findByRole("button", { name: "Link a reimbursement" }),
  );
  await user.click(
    await screen.findByRole("button", { name: /Shoe shop refund/ }),
  );
  await user.click(screen.getByRole("button", { name: "Link" }));

  // The money in is always the path; the expense is the body.
  await waitFor(() =>
    assert.deepEqual(apiMock.post.mock.calls[0], [
      "/v1/account/transaction/2/reimbursements",
      { expenseTransactionId: 1, amount: 20 },
    ]),
  );
});

test("a transfer has no reimbursement part", () => {
  renderField(row({ transactionTypeKey: { name: "TRANSFER_IN" } }));
  assert.equal(screen.queryByText("Reimbursement"), null);
  assert.equal(apiMock.get.mock.calls.length, 0);
});
