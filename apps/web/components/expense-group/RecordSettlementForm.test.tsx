// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, test, vi } from "vitest";

import type {
  ExpenseGroup,
  ExpenseGroupMember,
  SettlementSuggestion,
} from "@/lib/api/expense-group/types";
import { formatDateInputValue } from "@/lib/loans/calendar-day";

import enCommon from "../../messages/en/common.json";
import enExpenseGroups from "../../messages/en/expense-groups.json";
import enTransactions from "../../messages/en/transactions.json";
import {
  RecordSettlementForm,
  type SettlementPrefill,
} from "./RecordSettlementForm";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("@/lib/api/api", () => ({ default: apiMock }));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

afterEach(cleanup);

const member = (
  expenseGroupMemberKey: number,
  name: string,
  overrides: Partial<ExpenseGroupMember> = {},
): ExpenseGroupMember => ({
  expenseGroupMemberKey,
  name,
  email: null,
  appuserKey: null,
  isHouseholdMember: false,
  isYou: false,
  position: expenseGroupMemberKey,
  ...overrides,
});

const ana = member(1, "Ana", {
  appuserKey: 10,
  isHouseholdMember: true,
  isYou: true,
});
const rui = member(2, "Rui", { appuserKey: 11, isHouseholdMember: true });
const sam = member(3, "Sam");

const trip: ExpenseGroup = {
  expenseGroupKey: 4,
  name: "Lisbon trip",
  currencyCode: "EUR",
  archived: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  members: [ana, rui, sam],
  yourBalances: [],
};

const transfer: SettlementSuggestion = {
  transactionKey: 55,
  description: "Transfer from Sam",
  merchantName: null,
  transactionDate: "2026-11-03T00:00:00.000Z",
  settlementAmount: 40,
  currencyCode: "EUR",
  accountKey: 1,
  accountName: "Current account",
  remainingAmount: 40,
};

let suggestions: SettlementSuggestion[];

beforeEach(() => {
  vi.clearAllMocks();
  suggestions = [transfer];
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/v1/account/currencies") {
      return {
        data: {
          currencies: [
            { currencyKey: 1, code: "EUR", description: "Euro" },
            { currencyKey: 2, code: "USD", description: "US dollar" },
          ],
        },
      };
    }
    if (url === "/v1/expense-groups/4/settlements/suggestions") {
      return { data: { suggestions } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

function renderForm(prefill: SettlementPrefill | null = null) {
  const onDone = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enTransactions, ...enExpenseGroups }}
      >
        <RecordSettlementForm
          group={trip}
          prefill={prefill}
          onDone={onDone}
          onCancel={() => {}}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onDone };
}

const select = (name: string) =>
  screen.getByRole("combobox", { name }) as HTMLSelectElement;
const amountField = () =>
  screen.getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: "Record settlement" });

test("records a suggested payment, prefilled, linked to the money that came in", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { settlement: {} } });
  const { onDone } = renderForm({
    fromMemberKey: 3,
    toMemberKey: 1,
    amount: 25,
    currencyCode: "EUR",
  });

  assert.equal(select("From").value, "3");
  assert.equal(select("To").value, "1");
  assert.equal(amountField().value, "25");
  assert.equal(select("Currency").value, "EUR");
  assert.equal(
    (screen.getByLabelText("Date") as HTMLInputElement).value,
    formatDateInputValue(new Date()),
  );

  // Sam is outside the household and Ana in it: the transaction can be linked.
  const candidate = await screen.findByRole("button", {
    name: /Transfer from Sam/,
  });
  await waitFor(() =>
    assert.deepEqual(apiMock.get.mock.calls.at(-1), [
      "/v1/expense-groups/4/settlements/suggestions",
      {
        params: {
          fromMemberId: 3,
          toMemberId: 1,
          currencyCode: "EUR",
          search: undefined,
          limit: 20,
        },
      },
    ]),
  );
  await user.click(candidate);
  assert.equal(candidate.getAttribute("aria-pressed"), "true");
  await user.type(screen.getByLabelText("Notes (optional)"), "Dinner");

  await user.click(submit());

  await waitFor(() => assert.equal(apiMock.post.mock.calls.length, 1));
  assert.deepEqual(apiMock.post.mock.calls[0], [
    "/v1/expense-groups/4/settlements",
    {
      fromMemberId: 3,
      toMemberId: 1,
      amount: 25,
      settledOn: formatDateInputValue(new Date()),
      currencyCode: "EUR",
      notes: "Dinner",
      transactionId: 55,
    },
  ]);
  await waitFor(() => assert.equal(onDone.mock.calls.length, 1));
  assert.deepEqual(toastMock.success.mock.calls[0], ["Settlement recorded"]);
});

test("a blank form defaults to the group's currency, and links nothing between household members", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { settlement: {} } });
  renderForm();

  assert.equal(select("From").value, "1");
  assert.equal(select("To").value, "2");
  assert.equal(select("Currency").value, "EUR");
  // Ana and Rui are both of the household: no money crossed its edge.
  assert.equal(
    screen.queryByText("Link a transaction (optional)") === null,
    true,
  );

  await user.type(amountField(), "12.5");
  await user.click(submit());

  await waitFor(() => assert.equal(apiMock.post.mock.calls.length, 1));
  assert.deepEqual(apiMock.post.mock.calls[0]![1], {
    fromMemberId: 1,
    toMemberId: 2,
    amount: 12.5,
    settledOn: formatDateInputValue(new Date()),
    currencyCode: "EUR",
    notes: null,
    transactionId: null,
  });
  // No suggestions were asked for.
  assert.equal(
    apiMock.get.mock.calls.some(([url]) =>
      String(url).includes("/suggestions"),
    ),
    false,
  );
});

test("choosing another person drops the linked transaction", async () => {
  const user = userEvent.setup();
  renderForm({
    fromMemberKey: 3,
    toMemberKey: 1,
    amount: 25,
    currencyCode: "EUR",
  });

  const candidate = await screen.findByRole("button", {
    name: /Transfer from Sam/,
  });
  await user.click(candidate);
  await user.selectOptions(select("To"), "2");
  // Sam to Rui still crosses the edge; the list is asked again for them, nothing chosen.
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("button", { name: /Transfer from Sam/ })
        .getAttribute("aria-pressed"),
      "false",
    ),
  );
});

test("the same person on both sides, or no amount, is not sent", async () => {
  const user = userEvent.setup();
  renderForm();

  await user.selectOptions(select("To"), "1");
  await user.click(submit());

  assert.ok(screen.getByText("Choose two different people."));
  assert.ok(screen.getByText(/Enter an amount above zero/));
  assert.equal(apiMock.post.mock.calls.length, 0);
});

test("a refusal from the API is said in the form", async () => {
  const user = userEvent.setup();
  apiMock.post.mockRejectedValue({
    response: { status: 400, data: { code: "expense_group_amount_exceeded" } },
  });
  const { onDone } = renderForm({
    fromMemberKey: 3,
    toMemberKey: 1,
    amount: 25,
    currencyCode: "EUR",
  });
  await user.click(
    await screen.findByRole("button", { name: /Transfer from Sam/ }),
  );
  await user.click(submit());

  const alert = await screen.findByRole("alert");
  assert.equal(
    alert.textContent,
    "That is more than what is left to link on the transaction.",
  );
  assert.equal(onDone.mock.calls.length, 0);
});
