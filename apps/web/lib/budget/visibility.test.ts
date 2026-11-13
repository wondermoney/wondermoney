import assert from "node:assert/strict";

import { test } from "vitest";

import {
  budgetVisibilityOf,
  groupBudgetsByVisibility,
  isPersonalBudget,
  linkableAccountsFor,
  linkedAccountKeysWithin,
} from "./visibility";

test("a budget without a visibility, from an older server, is a household budget", () => {
  assert.equal(budgetVisibilityOf({}), "household");
  assert.equal(budgetVisibilityOf({ visibility: undefined }), "household");
  assert.equal(isPersonalBudget({}), false);
});

test("a personal budget reads as personal", () => {
  assert.equal(budgetVisibilityOf({ visibility: "personal" }), "personal");
  assert.equal(isPersonalBudget({ visibility: "personal" }), true);
  assert.equal(isPersonalBudget({ visibility: "household" }), false);
});

test("budgets of one kind form a single group, in their order", () => {
  const budgets = [
    { budgetKey: 1 },
    { budgetKey: 2, visibility: "household" as const },
  ];

  assert.deepEqual(groupBudgetsByVisibility(budgets), [
    { visibility: "household", budgets },
  ]);

  const personal = [{ budgetKey: 3, visibility: "personal" as const }];
  assert.deepEqual(groupBudgetsByVisibility(personal), [
    { visibility: "personal", budgets: personal },
  ]);
});

test("household and personal budgets split into two groups, household first", () => {
  const groups = groupBudgetsByVisibility([
    { budgetKey: 1, visibility: "personal" as const },
    { budgetKey: 2 },
    { budgetKey: 3, visibility: "personal" as const },
    { budgetKey: 4, visibility: "household" as const },
  ]);

  assert.deepEqual(
    groups.map((group) => [
      group.visibility,
      group.budgets.map((budget) => budget.budgetKey),
    ]),
    [
      ["household", [2, 4]],
      ["personal", [1, 3]],
    ],
  );
});

test("no budgets, no groups", () => {
  assert.deepEqual(groupBudgetsByVisibility([]), []);
});

const accounts = [
  { accountKey: 1, isPrivate: false },
  { accountKey: 2, isPrivate: true },
  { accountKey: 3, isPrivate: false },
];

test("a household budget is offered only the accounts that are not private", () => {
  assert.deepEqual(
    linkableAccountsFor(accounts, "household").map((account) => account.accountKey),
    [1, 3],
  );
});

test("a personal budget is offered every account the user can see", () => {
  assert.deepEqual(
    linkableAccountsFor(accounts, "personal").map((account) => account.accountKey),
    [1, 2, 3],
  );
});

test("a linked account the picker no longer offers is not sent back", () => {
  const offered = linkableAccountsFor(accounts, "household");

  assert.deepEqual(linkedAccountKeysWithin([3, 2, 9], offered), [3]);
  assert.deepEqual(linkedAccountKeysWithin([], offered), []);
});
