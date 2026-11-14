// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import { amountToUnits } from "@/lib/account/transaction-split";
import type { Transaction } from "@/lib/api/account/useTransactions";
import type { Category } from "@/lib/api/category/useCategories";

import enCategories from "../../messages/en/categories.json";
import enCommon from "../../messages/en/common.json";
import enExpenseGroups from "../../messages/en/expense-groups.json";
import enTransactions from "../../messages/en/transactions.json";
import { TransactionSplitField, useSplitDraft } from "./TransactionSplitField";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: () => {} }),
}));

beforeAll(() => {
  // jsdom lacks the layout APIs that Radix Popper and cmdk call.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

const groceries = {
  categoryKey: 11,
  name: "Groceries",
  isSystemCategory: false,
} as Category;

const purchase = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    transactionKey: 7,
    settlementAmount: -100,
    settlementCurrencyKey: { code: "EUR" },
    appuserSettlementAmount: -100,
    appuserCurrencyKey: { code: "EUR" },
    appuserTransactionCategories: [groceries],
    splits: [],
    ...overrides,
  }) as Transaction;

/** The field as the edit sheet uses it, with a save button gated the same way. */
function Harness({ transaction }: { transaction: Transaction }) {
  const split = useSplitDraft(
    transaction,
    amountToUnits(transaction.settlementAmount),
  );
  return (
    <>
      <TransactionSplitField
        split={split}
        transaction={transaction}
        categories={[]}
        amountChanged={false}
        onRemoved={() => {}}
      />
      <button type="button" disabled={!split.changed || split.blocked}>
        Save
      </button>
    </>
  );
}

function renderField(transaction = purchase(), locale = "en") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale={locale}
        messages={{
          ...enCommon,
          ...enCategories,
          ...enTransactions,
          ...enExpenseGroups,
        }}
      >
        <Harness transaction={transaction} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const amountInput = (number: number) =>
  screen.getByRole("textbox", {
    name: `Amount for line ${number}`,
  }) as HTMLInputElement;
const save = () => screen.getByRole("button", { name: "Save" });
const remainder = () =>
  screen.getByText(/Remaining to assign|Over by|Fully assigned/).parentElement!;

test("starts with the current category's full amount and an empty line, and blocks saving", async () => {
  const user = userEvent.setup();
  renderField();

  await user.click(screen.getByRole("button", { name: "Split" }));

  assert.equal(amountInput(1).value, "100");
  assert.equal(amountInput(2).value, "");
  assert.ok(screen.getByText("Give every line an amount."));
  assert.equal((save() as HTMLButtonElement).disabled, true);
});

test("shows the remainder live and fills it into a line", async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(screen.getByRole("button", { name: "Split" }));

  await user.type(amountInput(2), "40");
  assert.match(remainder().textContent ?? "", /Over by.*40\.00/);
  assert.equal((save() as HTMLButtonElement).disabled, true);

  await user.clear(amountInput(1));
  await user.type(amountInput(1), "50");
  assert.match(remainder().textContent ?? "", /Remaining to assign.*10\.00/);
  assert.ok(screen.getByText(/must add up to the transaction's amount/));

  await user.click(
    screen.getByRole("button", {
      name: "Add the remaining amount to line 1",
    }),
  );
  assert.equal(amountInput(1).value, "60");
  assert.ok(screen.getByText("Fully assigned"));
  assert.equal((save() as HTMLButtonElement).disabled, false);
});

test("splits evenly to the cent and turns a percentage into its amount", async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(screen.getByRole("button", { name: "Split" }));
  await user.click(screen.getByRole("button", { name: "Add line" }));
  await user.click(screen.getByRole("button", { name: "Split evenly" }));

  assert.deepEqual(
    [1, 2, 3].map((number) => amountInput(number).value),
    ["33.34", "33.33", "33.33"],
  );
  assert.equal((save() as HTMLButtonElement).disabled, false);

  await user.clear(amountInput(3));
  await user.type(amountInput(3), "25%");
  await user.tab();
  assert.equal(amountInput(3).value, "25");
});

test("reads amounts in the reader's locale", async () => {
  const user = userEvent.setup();
  renderField(purchase({ settlementAmount: -1234.5 }), "pt");
  await user.click(screen.getByRole("button", { name: "Split" }));

  // The full amount is written back with a decimal comma, and "1.000,5" is read as 1000.5.
  assert.equal(amountInput(1).value, "1234,5");
  await user.clear(amountInput(1));
  await user.type(amountInput(1), "1.000,5");
  await user.type(amountInput(2), "234");
  assert.ok(screen.getByText("Fully assigned"));
});

test("an unreadable or zero line explains itself", async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(screen.getByRole("button", { name: "Split" }));

  await user.type(amountInput(2), "abc");
  assert.ok(screen.getByText("Enter an amount or a percentage."));
  await user.clear(amountInput(2));
  await user.type(amountInput(2), "0");
  assert.ok(screen.getByText("A line can't be zero."));
  assert.equal((save() as HTMLButtonElement).disabled, true);
});

test("a split transaction opens on its lines, with Remove split, and saves nothing until changed", () => {
  renderField(
    purchase({
      splits: [
        {
          transactionSplitKey: 1,
          amount: -60,
          appuserAmount: -60,
          category: groceries,
          notes: "Food",
          position: 0,
        },
        {
          transactionSplitKey: 2,
          amount: -40,
          appuserAmount: -40,
          category: null,
          notes: null,
          position: 1,
        },
      ],
    }),
  );

  assert.equal(amountInput(1).value, "60");
  assert.equal(amountInput(2).value, "40");
  assert.equal(
    (
      screen.getByRole("textbox", {
        name: "Note for line 1",
      }) as HTMLInputElement
    ).value,
    "Food",
  );
  assert.ok(screen.getByRole("button", { name: "Remove split" }));
  assert.equal((save() as HTMLButtonElement).disabled, true);
});

test("a loan repayment cannot be split", () => {
  renderField(
    purchase({
      loanRepayment: {
        loanKey: 1,
        loanName: "Car",
        principalAmount: 80,
        interestAmount: 20,
        feeAmount: 0,
        spendingAmount: 0,
      },
    }),
  );
  assert.equal(screen.queryByRole("button", { name: "Split" }), null);
  assert.ok(screen.getByText(/loan repayment/));
});

test("a transaction shared in a group offers no split editing: its shares are the group's", () => {
  const share = (key: number, name: string) => ({
    transactionSplitKey: key,
    amount: -50,
    appuserAmount: -50,
    category: {
      categoryKey: 11,
      name: "Groceries",
      icon: "",
      bgColor: "",
      isSystemCategory: false,
    },
    notes: null,
    position: key,
    expenseGroupMember: {
      expenseGroupKey: 4,
      expenseGroupMemberKey: key,
      isHouseholdMember: key === 1,
      name,
    },
  });
  renderField(purchase({ splits: [share(1, "Ana"), share(2, "Sam")] }));

  // No editor, no "Split", no "Remove split"; the reader is pointed at the group's shares.
  assert.equal(
    screen.queryByRole("textbox", { name: "Amount for line 1" }) === null,
    true,
  );
  assert.equal(screen.queryByRole("button", { name: "Split" }) === null, true);
  assert.equal(
    screen.queryByRole("button", { name: "Remove split" }) === null,
    true,
  );
  assert.ok(
    screen.getByText(/Shared in a group: change its shares with Edit shares/),
  );
  assert.ok(screen.getByText("Groceries"));
  assert.equal((save() as HTMLButtonElement).disabled, true);
});
