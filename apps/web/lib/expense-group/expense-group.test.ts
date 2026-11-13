import assert from "node:assert/strict";

import { test } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";
import type {
  ExpenseGroup,
  ExpenseGroupMember,
  GroupExpense,
} from "@/lib/api/expense-group/types";

import { amountToUnits } from "../account/transaction-split";
import {
  balanceStatus,
  canLinkSettlement,
  defaultPayerKey,
  expenseGroupErrorKey,
  groupShareBlocker,
  nonZeroBalances,
  partitionGroups,
  paymentPerspective,
  prefillShares,
  previewShares,
  sharedGroupOf,
  toShareRequest,
} from "./expense-group";

const units = (amount: number) => amountToUnits(amount);
const amounts = (preview: ReturnType<typeof previewShares>) =>
  preview.shares.map((share) =>
    share.units === null ? null : Number(share.units) / 10000,
  );

const person = (memberKey: number, value = "") => ({ memberKey, value });

// ---------------------------------------------------------------------------------------------
// previewShares: the server's rules (`expense-group-math.ts#computeShares`), live
// ---------------------------------------------------------------------------------------------

test("equal: each share rounds to the cent, the remainder on the first person", () => {
  const preview = previewShares(
    units(-100),
    "equal",
    [person(1), person(2), person(3)],
    "en",
  );
  assert.deepEqual(amounts(preview), [-33.34, -33.33, -33.33]);
  assert.equal(preview.problem, null);
  assert.equal(preview.remainingUnits, 0n);
});

test("equal: half a cent rounds up, and the first person absorbs it the other way", () => {
  // 10 / 6 = 1.6666… → 1.67 each, the first takes 10 - 5 × 1.67 = 1.65.
  const preview = previewShares(
    units(10),
    "equal",
    [1, 2, 3, 4, 5, 6].map((key) => person(key)),
    "en",
  );
  assert.deepEqual(amounts(preview), [1.65, 1.67, 1.67, 1.67, 1.67, 1.67]);
  // 0.05 / 2 = 0.025 → 0.03, the first 0.02.
  assert.deepEqual(
    amounts(previewShares(units(-0.05), "equal", [person(1), person(2)], "en")),
    [-0.02, -0.03],
  );
});

test("equal: a share that rounds to nothing cannot be saved", () => {
  const preview = previewShares(
    units(-0.01),
    "equal",
    [person(1), person(2), person(3)],
    "en",
  );
  assert.equal(preview.problem, "zero-share");
});

test("nobody to share with is a problem", () => {
  assert.equal(
    previewShares(units(-10), "equal", [], "en").problem,
    "no-people",
  );
});

test("amounts: positive magnitudes that must add up to the whole, signed like it", () => {
  const preview = previewShares(
    units(-50),
    "amounts",
    [person(1, "20"), person(2, "30")],
    "en",
  );
  assert.deepEqual(amounts(preview), [-20, -30]);
  assert.equal(preview.problem, null);

  const short = previewShares(
    units(-50),
    "amounts",
    [person(1, "20"), person(2, "25.5")],
    "en",
  );
  assert.equal(short.problem, "unassigned");
  assert.equal(short.remainingUnits, units(4.5));

  const over = previewShares(
    units(-50),
    "amounts",
    [person(1, "20"), person(2, "35")],
    "en",
  );
  assert.equal(over.problem, "over-assigned");
  assert.equal(over.remainingUnits, units(-5));
});

test("amounts: a blank, zero or unreadable amount is a line problem", () => {
  for (const value of ["", "0", "abc"]) {
    const preview = previewShares(
      units(-50),
      "amounts",
      [person(1, "50"), person(2, value)],
      "en",
    );
    assert.equal(preview.problem, "line-errors", value);
  }
  // Read in the reader's locale.
  const pt = previewShares(
    units(-1000.5),
    "amounts",
    [person(1, "1.000,5")],
    "pt",
  );
  assert.equal(pt.problem, null);
});

test("percentages: they must make exactly 100, with at most two decimals", () => {
  const preview = previewShares(
    units(-90),
    "percentages",
    [person(1, "50"), person(2, "25"), person(3, "25")],
    "en",
  );
  assert.deepEqual(amounts(preview), [-45, -22.5, -22.5]);
  assert.equal(preview.problem, null);

  const short = previewShares(
    units(-90),
    "percentages",
    [person(1, "50"), person(2, "25.5")],
    "en",
  );
  assert.equal(short.problem, "unassigned");
  assert.equal(short.remainingPercent, 24.5);

  const over = previewShares(
    units(-90),
    "percentages",
    [person(1, "60"), person(2, "50%")],
    "en",
  );
  assert.equal(over.problem, "over-assigned");
  assert.equal(over.remainingPercent, -10);

  const precise = previewShares(
    units(-90),
    "percentages",
    [person(1, "33.333"), person(2, "66.667")],
    "en",
  );
  assert.equal(precise.problem, "line-errors");
  assert.equal(precise.shares[0]!.error, "too-precise");
});

test("percentages: the rounding remainder goes on the largest percentage", () => {
  // 100 × 33.33% = 33.33, 100 × 33.33% = 33.33, 100 × 33.34% → takes the rest.
  const preview = previewShares(
    units(-100),
    "percentages",
    [person(1, "33.33"), person(2, "33.34"), person(3, "33.33")],
    "en",
  );
  assert.deepEqual(amounts(preview), [-33.33, -33.34, -33.33]);
  // 10 at 33.33/33.33/33.34: 3.33 + 3.33, the largest takes 3.34.
  const ten = previewShares(
    units(10),
    "percentages",
    [person(1, "33.33"), person(2, "33.33"), person(3, "33.34")],
    "en",
  );
  assert.deepEqual(amounts(ten), [3.33, 3.33, 3.34]);
});

test("toShareRequest sends what each method needs, positive", () => {
  const people = [person(1, "20"), person(2, "30")];
  assert.deepEqual(
    toShareRequest(
      "amounts",
      people,
      previewShares(units(-50), "amounts", people, "en"),
    ),
    [
      { memberId: 1, amount: 20 },
      { memberId: 2, amount: 30 },
    ],
  );
  const percents = [person(1, "60"), person(2, "40")];
  assert.deepEqual(
    toShareRequest(
      "percentages",
      percents,
      previewShares(units(-50), "percentages", percents, "en"),
    ),
    [
      { memberId: 1, percentage: 60 },
      { memberId: 2, percentage: 40 },
    ],
  );
  const equal = [person(1), person(2)];
  assert.deepEqual(
    toShareRequest(
      "equal",
      equal,
      previewShares(units(-50), "equal", equal, "en"),
    ),
    [{ memberId: 1 }, { memberId: 2 }],
  );
});

// ---------------------------------------------------------------------------------------------
// Balances and wording
// ---------------------------------------------------------------------------------------------

test("a positive balance is owed, a negative one owes, zero is settled", () => {
  assert.equal(balanceStatus(12.5), "owed");
  assert.equal(balanceStatus(-0.01), "owes");
  assert.equal(balanceStatus(0), "settled");
  assert.equal(balanceStatus(0.00001), "settled");
});

test("only the currencies where the viewer is not square", () => {
  assert.deepEqual(
    nonZeroBalances([
      { currencyCode: "EUR", amount: 0 },
      { currencyCode: "USD", amount: -3 },
    ]),
    [{ currencyCode: "USD", amount: -3 }],
  );
});

const member = (
  expenseGroupMemberKey: number,
  overrides: Partial<ExpenseGroupMember> = {},
): ExpenseGroupMember => ({
  expenseGroupMemberKey,
  name: `Person ${expenseGroupMemberKey}`,
  email: null,
  appuserKey: null,
  isHouseholdMember: false,
  isYou: false,
  position: expenseGroupMemberKey,
  ...overrides,
});

const you = member(1, { appuserKey: 10, isHouseholdMember: true, isYou: true });
const partner = member(2, { appuserKey: 11, isHouseholdMember: true });
const friend = member(3);
const members = [you, partner, friend];

test("a payment reads from the viewer's side when they are in it", () => {
  assert.equal(
    paymentPerspective({ fromMemberKey: 1, toMemberKey: 3 }, members),
    "you-owe",
  );
  assert.equal(
    paymentPerspective({ fromMemberKey: 3, toMemberKey: 1 }, members),
    "owes-you",
  );
  assert.equal(
    paymentPerspective({ fromMemberKey: 3, toMemberKey: 2 }, members),
    "others",
  );
});

test("a transaction can be linked to a settlement only between the household and outside it", () => {
  assert.equal(canLinkSettlement(members, 3, 1), true);
  assert.equal(canLinkSettlement(members, 1, 3), true);
  assert.equal(canLinkSettlement(members, 1, 2), false);
  assert.equal(canLinkSettlement([...members, member(4)], 3, 4), false);
});

test("the payer defaults to the viewer, else the first household member", () => {
  assert.equal(defaultPayerKey(members), 1);
  assert.equal(
    defaultPayerKey([friend, { ...partner }, { ...you, isYou: false }]),
    2,
  );
  assert.equal(defaultPayerKey([friend]), null);
});

const group = (expenseGroupKey: number, archived: boolean): ExpenseGroup => ({
  expenseGroupKey,
  name: `Group ${expenseGroupKey}`,
  currencyCode: "EUR",
  archived,
  createdAt: "2026-11-01T00:00:00.000Z",
  members,
  yourBalances: [],
});

test("active groups first, archived ones apart, each in the API's order", () => {
  const { active, archived } = partitionGroups([
    group(3, false),
    group(2, true),
    group(1, false),
  ]);
  assert.deepEqual(
    active.map((g) => g.expenseGroupKey),
    [3, 1],
  );
  assert.deepEqual(
    archived.map((g) => g.expenseGroupKey),
    [2],
  );
});

// ---------------------------------------------------------------------------------------------
// The transaction side
// ---------------------------------------------------------------------------------------------

const row = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    transactionKey: 7,
    settlementAmount: -60,
    settlementCurrencyKey: { code: "EUR" },
    transactionTypeKey: { name: "PAYMENT" },
    splits: [],
    reimbursements: [],
    ...overrides,
  }) as Transaction;

test("a transaction is shared when a split line names a group member", () => {
  assert.equal(sharedGroupOf(row()), null);
  const shared = row({
    splits: [
      {
        transactionSplitKey: 1,
        amount: -30,
        appuserAmount: -30,
        category: null,
        notes: null,
        position: 0,
        expenseGroupMember: {
          expenseGroupKey: 4,
          expenseGroupMemberKey: 1,
          isHouseholdMember: true,
          name: "You",
        },
      },
    ],
  });
  assert.equal(sharedGroupOf(shared), 4);
});

test("what keeps a transaction out of a group", () => {
  assert.equal(groupShareBlocker(row()), null);
  assert.equal(
    groupShareBlocker(row({ transactionTypeKey: { name: "TRANSFER_OUT" } })),
    "transfer",
  );
  assert.equal(
    groupShareBlocker(
      row({ loanRepayment: {} as Transaction["loanRepayment"] }),
    ),
    "loan-repayment",
  );
  assert.equal(
    groupShareBlocker(
      row({
        reimbursements: [{}] as Transaction["reimbursements"],
      }),
    ),
    "reimbursement",
  );
  assert.equal(groupShareBlocker(row({ settlementAmount: 0 })), "zero");
  assert.equal(groupShareBlocker(row({ transactionKey: -1 })), "unavailable");
});

const expense = (
  splitMethod: GroupExpense["splitMethod"],
  shares: [number, number][],
): GroupExpense => ({
  expenseGroupExpenseKey: 1,
  expenseGroupKey: 4,
  categoryKey: null,
  currencyCode: "EUR",
  paidByMemberKey: 1,
  splitMethod,
  shares: shares.map(([expenseGroupMemberKey, amount]) => ({
    expenseGroupMemberKey,
    amount,
  })),
  transaction: {
    transactionKey: 7,
    description: "Dinner",
    merchantName: null,
    transactionDate: null,
    settlementAmount: shares.reduce((sum, [, amount]) => sum + amount, 0),
    currencyCode: "EUR",
    accountKey: 1,
    accountName: "Current",
  },
});

test("editing shares starts from how they were shared", () => {
  assert.deepEqual(
    prefillShares(
      expense("amounts", [
        [1, -20],
        [3, -40],
      ]),
      "en",
    ),
    { method: "amounts", values: { 1: "20", 3: "40" } },
  );
  assert.deepEqual(
    prefillShares(
      expense("equal", [
        [1, -30],
        [3, -30],
      ]),
      "en",
    ),
    { method: "equal", values: { 1: "", 3: "" } },
  );
  // Back to percentages that make 100: 1/3 each is 33.33, the largest share the rest.
  assert.deepEqual(
    prefillShares(
      expense("percentages", [
        [1, -33.34],
        [2, -33.33],
        [3, -33.33],
      ]),
      "en",
    ),
    { method: "percentages", values: { 1: "33.34", 2: "33.33", 3: "33.33" } },
  );
});

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

const apiError = (code: string) => ({ response: { data: { code } } });

test("maps the API's refusals to messages", () => {
  assert.equal(
    expenseGroupErrorKey(apiError("expense_group_member_in_use")),
    "member-in-use",
  );
  assert.equal(
    expenseGroupErrorKey(apiError("expense_group_not_empty")),
    "not-empty",
  );
  assert.equal(
    expenseGroupErrorKey(apiError("expense_group_transaction_conflict")),
    "transaction-conflict",
  );
  assert.equal(
    expenseGroupErrorKey(apiError("transaction_in_expense_group")),
    "transaction-in-group",
  );
  assert.equal(expenseGroupErrorKey(apiError("something_else")), null);
  assert.equal(expenseGroupErrorKey(new Error("boom")), null);
});
