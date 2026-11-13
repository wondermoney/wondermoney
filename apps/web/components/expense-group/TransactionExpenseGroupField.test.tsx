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
import { forwardRef } from "react";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";
import type {
  ExpenseGroup,
  ExpenseGroupMember,
  GroupExpense,
} from "@/lib/api/expense-group/types";

import enCommon from "../../messages/en/common.json";
import enExpenseGroups from "../../messages/en/expense-groups.json";
import enTransactions from "../../messages/en/transactions.json";
import { TransactionExpenseGroupField } from "./TransactionExpenseGroupField";

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
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  Link: forwardRef<
    HTMLAnchorElement,
    { href: string; children?: React.ReactNode }
  >(function Link({ href, children, ...props }, ref) {
    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    );
  }),
}));

beforeAll(() => {
  // jsdom lacks the layout APIs Radix calls.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

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

const purchase = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    transactionKey: 7,
    settlementAmount: -100,
    settlementCurrencyKey: { code: "EUR" },
    appuserSettlementAmount: -100,
    appuserCurrencyKey: { code: "EUR" },
    appuserTransactionCategories: [],
    transactionTypeKey: { name: "PAYMENT" },
    splits: [],
    reimbursements: [],
    ...overrides,
  }) as Transaction;

const sharedLine = (key: number, who: ExpenseGroupMember, amount: number) => ({
  transactionSplitKey: key,
  amount,
  appuserAmount: amount,
  category: null,
  notes: null,
  position: key,
  expenseGroupMember: {
    expenseGroupKey: 4,
    expenseGroupMemberKey: who.expenseGroupMemberKey,
    isHouseholdMember: who.isHouseholdMember,
    name: who.name,
  },
});

const sharedPurchase = () =>
  purchase({
    splits: [sharedLine(1, ana, -50), sharedLine(2, sam, -50)],
  });

const sharedExpense: GroupExpense = {
  expenseGroupExpenseKey: 9,
  expenseGroupKey: 4,
  categoryKey: null,
  currencyCode: "EUR",
  paidByMemberKey: 1,
  splitMethod: "equal",
  shares: [
    { expenseGroupMemberKey: 1, amount: -50 },
    { expenseGroupMemberKey: 3, amount: -50 },
  ],
  transaction: {
    transactionKey: 7,
    description: "Dinner",
    merchantName: null,
    transactionDate: "2026-11-02T00:00:00.000Z",
    settlementAmount: -100,
    currencyCode: "EUR",
    accountKey: 1,
    accountName: "Current account",
  },
};

let role: "member" | "viewer";
let groups: ExpenseGroup[];

beforeEach(() => {
  vi.clearAllMocks();
  role = "member";
  groups = [trip];
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/v1/household") {
      return {
        data: {
          members: [{ appuserKey: 10, emailAddress: "ana@example.com", role }],
          viewerAppuserKey: 10,
        },
      };
    }
    if (url === "/v1/expense-groups") return { data: { groups } };
    if (url === "/v1/expense-groups/4/shares/7") {
      return { data: { expense: sharedExpense } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

function renderField(transaction = purchase()) {
  const onChanged = vi.fn();
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
        <TransactionExpenseGroupField
          transaction={transaction}
          categories={[]}
          onChanged={onChanged}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onChanged };
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  const action = await screen.findByRole("button", {
    name: "Split with group",
  });
  await waitFor(() =>
    assert.equal((action as HTMLButtonElement).disabled, false),
  );
  await user.click(action);
}

const status = () =>
  screen.getByText(
    /Left to assign|Over by|All assigned|Every person|Pick at least/,
  );

test("splits a purchase equally, the remainder on the first person, paid by the viewer", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { expense: sharedExpense } });
  const { onChanged } = renderField();

  await openEditor(user);

  assert.equal(
    (screen.getByRole("combobox", { name: "Group" }) as HTMLSelectElement)
      .value,
    "4",
  );
  // Only someone of the household can have paid; the viewer by default.
  const payer = screen.getByRole("combobox", {
    name: "Paid by",
  }) as HTMLSelectElement;
  assert.deepEqual(
    within(payer)
      .getAllByRole("option")
      .map((option) => option.textContent),
    ["Ana", "Rui"],
  );
  assert.equal(payer.value, "1");
  assert.equal(
    (screen.getByRole("radio", { name: "Equally" }) as HTMLInputElement)
      .checked,
    true,
  );
  const people = screen.getByRole("group", { name: "People" });
  assert.match(people.textContent ?? "", /Ana€33\.34/);
  assert.match(people.textContent ?? "", /Rui€33\.33/);
  assert.match(people.textContent ?? "", /Sam€33\.33/);
  assert.equal(status().textContent, "All assigned");

  await user.click(screen.getByRole("button", { name: "Share" }));

  await waitFor(() => assert.equal(apiMock.post.mock.calls.length, 1));
  assert.deepEqual(apiMock.post.mock.calls[0], [
    "/v1/expense-groups/4/shares",
    {
      transactionId: 7,
      paidByMemberId: 1,
      method: "equal",
      shares: [{ memberId: 1 }, { memberId: 2 }, { memberId: 3 }],
    },
  ]);
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
  assert.deepEqual(toastMock.success.mock.calls[0], [
    "Shared with Lisbon trip",
  ]);
});

test("by amount: what is left to assign is live, and saving waits until it adds up", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { expense: sharedExpense } });
  renderField();
  await openEditor(user);

  await user.click(screen.getByRole("radio", { name: "By amount" }));
  await user.click(screen.getByRole("checkbox", { name: "Rui" }));
  assert.equal(
    screen.queryByRole("textbox", { name: "Amount for Rui" }) === null,
    true,
  );

  await user.type(
    screen.getByRole("textbox", { name: "Amount for Ana" }),
    "30",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Amount for Sam" }),
    "50",
  );
  assert.equal(status().textContent, "Left to assign: €20.00");

  await user.click(screen.getByRole("button", { name: "Share" }));
  assert.equal(apiMock.post.mock.calls.length, 0);

  const sam = screen.getByRole("textbox", { name: "Amount for Sam" });
  await user.clear(sam);
  await user.type(sam, "75");
  assert.equal(status().textContent, "Over by €5.00");

  await user.clear(sam);
  await user.type(sam, "70");
  assert.equal(status().textContent, "All assigned");
  await user.click(screen.getByRole("button", { name: "Share" }));

  await waitFor(() => assert.equal(apiMock.post.mock.calls.length, 1));
  assert.deepEqual(apiMock.post.mock.calls[0]![1], {
    transactionId: 7,
    paidByMemberId: 1,
    method: "amounts",
    shares: [
      { memberId: 1, amount: 30 },
      { memberId: 3, amount: 70 },
    ],
  });
});

test("by percentage: they must make 100", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValue({ data: { expense: sharedExpense } });
  renderField();
  await openEditor(user);

  await user.click(screen.getByRole("radio", { name: "By percentage" }));
  await user.type(
    screen.getByRole("textbox", { name: "Percentage for Ana" }),
    "50",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Percentage for Rui" }),
    "30",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Percentage for Sam" }),
    "30",
  );
  assert.equal(status().textContent, "Over by 10%");

  const sam = screen.getByRole("textbox", { name: "Percentage for Sam" });
  await user.clear(sam);
  await user.type(sam, "20");
  assert.equal(status().textContent, "All assigned");
  await user.click(screen.getByRole("button", { name: "Share" }));

  await waitFor(() => assert.equal(apiMock.post.mock.calls.length, 1));
  assert.deepEqual(apiMock.post.mock.calls[0]![1].shares, [
    { memberId: 1, percentage: 50 },
    { memberId: 2, percentage: 30 },
    { memberId: 3, percentage: 20 },
  ]);
});

test("a refusal from the API is said in the form", async () => {
  const user = userEvent.setup();
  apiMock.post.mockRejectedValue({
    response: {
      status: 409,
      data: { code: "expense_group_transaction_conflict" },
    },
  });
  const { onChanged } = renderField();
  await openEditor(user);
  await user.click(screen.getByRole("button", { name: "Share" }));

  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /already plays another part/);
  assert.equal(onChanged.mock.calls.length, 0);
});

test("a transfer between own accounts cannot be shared", async () => {
  renderField(purchase({ transactionTypeKey: { name: "TRANSFER_OUT" } }));
  await screen.findByText(
    "A transfer between your own accounts cannot be shared.",
  );
  assert.equal(
    screen.queryByRole("button", { name: "Split with group" }) === null,
    true,
  );
});

test("without an active group it points to creating one", async () => {
  groups = [{ ...trip, archived: true }];
  renderField();
  const link = await screen.findByRole("link", { name: "Create a group" });
  assert.equal(link.getAttribute("href"), "/groups");
});

test("a shared transaction shows its group, who paid and each share, and can stop sharing", async () => {
  const user = userEvent.setup();
  apiMock.delete.mockResolvedValue({ data: { transactionKey: 7 } });
  const { onChanged } = renderField(sharedPurchase());

  await screen.findByText(/Shared in Lisbon trip/);
  await screen.findByText(/Paid by Ana/);
  assert.equal(
    screen.getByRole("link", { name: "Open group" }).getAttribute("href"),
    "/groups/4",
  );
  const section = screen.getByRole("region", { name: "Shared expense" });
  assert.match(section.textContent ?? "", /Ana€50\.00/);
  assert.match(section.textContent ?? "", /Sam€50\.00/);

  await user.click(screen.getByRole("button", { name: "Stop sharing" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Stop sharing" }),
  );

  await waitFor(() =>
    assert.deepEqual(apiMock.delete.mock.calls[0], [
      "/v1/expense-groups/4/shares/7",
    ]),
  );
  await waitFor(() => assert.equal(onChanged.mock.calls.length, 1));
});

test("editing shares starts from how they are shared now", async () => {
  const user = userEvent.setup();
  renderField(sharedPurchase());

  const edit = await screen.findByRole("button", { name: "Edit shares" });
  await waitFor(() =>
    assert.equal((edit as HTMLButtonElement).disabled, false),
  );
  await user.click(edit);

  // The group is fixed; the people are those who had a share.
  assert.equal(
    screen.queryByRole("combobox", { name: "Group" }) === null,
    true,
  );
  assert.equal(
    (screen.getByRole("checkbox", { name: "Ana" }) as HTMLElement).getAttribute(
      "aria-checked",
    ),
    "true",
  );
  assert.equal(
    (screen.getByRole("checkbox", { name: "Rui" }) as HTMLElement).getAttribute(
      "aria-checked",
    ),
    "false",
  );
  assert.equal(status().textContent, "All assigned");
});

test("a viewer sees the shares and nothing to change them", async () => {
  role = "viewer";
  renderField(sharedPurchase());

  await screen.findByText(/Shared in Lisbon trip/);
  await waitFor(() =>
    assert.ok(apiMock.get.mock.calls.some(([url]) => url === "/v1/household")),
  );
  // Once the household says so, the actions go.
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("button", { name: "Stop sharing" }) === null,
      true,
    ),
  );
  assert.equal(
    screen.queryByRole("button", { name: "Edit shares" }) === null,
    true,
  );
});

test("a viewer is not offered to share a transaction", async () => {
  role = "viewer";
  renderField();
  await waitFor(() =>
    assert.ok(apiMock.get.mock.calls.some(([url]) => url === "/v1/household")),
  );
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("button", { name: "Split with group" }) === null,
      true,
    ),
  );
});
