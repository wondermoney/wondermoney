import assert from "node:assert/strict";

import { createTranslator } from "next-intl";
import { test } from "vitest";

import enRules from "../../messages/en/rules.json";
import { summarizeRule,type SummaryLookups } from "./rule-summary";

const t = createTranslator({
  locale: "en",
  messages: enRules,
  namespace: "rules",
}) as unknown as Parameters<typeof summarizeRule>[1];

const lookups: SummaryLookups = {
  category: (key) => ({ 1: "Entertainment", 2: "Groceries" })[key],
  account: (key) => ({ 10: "Current account" })[key],
  tag: (key) => ({ 5: "Subscriptions" })[key],
  transactionType: (name) => name.toLowerCase(),
  amount: (value) => value.toFixed(2),
};

test("reads a rule as its conditions, then what it does", () => {
  assert.equal(
    summarizeRule(
      {
        match: "all",
        conditions: [
          {
            field: "description",
            operator: "contains",
            source: "cleaned",
            value: "NETFLIX",
          },
          { field: "amount", operator: "lt", value: 20 },
        ],
        actions: [
          { type: "set_category", categoryId: 1 },
          { type: "add_tags", tagIds: [5] },
        ],
      },
      t,
      lookups,
    ),
    "Description contains NETFLIX and Amount is less than 20.00, set category Entertainment, add tags Subscriptions",
  );
});

test("joins any-of conditions with or, and marks what no longer exists", () => {
  assert.equal(
    summarizeRule(
      {
        match: "any",
        conditions: [
          {
            field: "category",
            operator: "in",
            values: ["uncategorized", 2, 99],
          },
          { field: "direction", operator: "is", value: "out" },
        ],
        actions: [{ type: "set_category", categoryId: 42 }],
      },
      t,
      lookups,
    ),
    "Category is any of Uncategorized, Groceries, (deleted) or Money out, set category (deleted)",
  );
});
