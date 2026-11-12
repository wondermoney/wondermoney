import assert from "node:assert/strict";

import { test } from "vitest";

import type { Transaction } from "@/lib/api/account/useTransactions";
import type { Rule } from "@/lib/api/rule/useRules";

import {
  changeConditionField,
  emptyRuleForm,
  formFromSuggestion,
  formFromTransaction,
  formToRule,
  newAction,
  newCondition,
  type RuleFormState,
  ruleToForm,
} from "./rule-draft";

const form = (overrides: Partial<RuleFormState>): RuleFormState => ({
  ...emptyRuleForm(),
  name: "Netflix",
  ...overrides,
});

test("a complete form becomes the API rule, with amounts read in the reader's locale", () => {
  const result = formToRule(
    form({
      match: "any",
      conditions: [
        { ...newCondition("description"), value: "  NETFLIX ", source: "raw" },
        { ...newCondition("amount"), operator: "lt", value: "1.234,5" },
        {
          ...newCondition("amount"),
          operator: "between",
          min: "5",
          max: "20,25",
        },
        {
          ...newCondition("category"),
          operator: "not_in",
          values: ["uncategorized", "7"],
        },
        { ...newCondition("direction"), value: "in" },
      ],
      actions: [
        { ...newAction("set_category"), categoryId: "12" },
        { ...newAction("set_merchant"), merchant: " Netflix " },
        { ...newAction("add_tags"), tagIds: [3] },
        newAction("hide"),
      ],
    }),
    "pt",
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.draft, {
    match: "any",
    conditions: [
      {
        field: "description",
        operator: "contains",
        source: "raw",
        value: "NETFLIX",
      },
      { field: "amount", operator: "lt", value: 1234.5 },
      { field: "amount", operator: "between", min: 5, max: 20.25 },
      { field: "category", operator: "not_in", values: ["uncategorized", 7] },
      { field: "direction", operator: "is", value: "in" },
    ],
    actions: [
      { type: "set_category", categoryId: 12 },
      { type: "set_merchant", merchantName: "Netflix" },
      { type: "add_tags", tagIds: [3] },
      { type: "hide" },
    ],
  });
});

test("names the rows the API would refuse, and needs a name only to save", () => {
  const empty = { ...newCondition("description"), value: "  " };
  const negative = { ...newCondition("amount"), value: "-5" };
  const tooPrecise = { ...newCondition("amount"), value: "1.00001" };
  const backwards = {
    ...newCondition("amount"),
    operator: "between",
    min: "20",
    max: "5",
  };
  const noAccounts = newCondition("account");
  const noCategory = newAction("set_category");
  const state = form({
    name: " ",
    conditions: [empty, negative, tooPrecise, backwards, noAccounts],
    actions: [noCategory, newAction("hide"), newAction("hide")],
  });

  const result = formToRule(state, "en");

  assert.equal(result.ok, false);
  assert.deepEqual(result.ok ? null : result.problems, {
    name: "name-required",
    conditions: {
      [empty.id]: "value-required",
      [negative.id]: "amount-invalid",
      [tooPrecise.id]: "amount-invalid",
      [backwards.id]: "range-invalid",
      [noAccounts.id]: "values-required",
    },
    actions: { [noCategory.id]: "category-required" },
    duplicateActions: true,
  });

  const unnamed = form({
    name: "",
    conditions: [{ ...newCondition(), value: "x" }],
    actions: [newAction("hide")],
  });
  assert.equal(formToRule(unnamed, "en").ok, false);
  assert.equal(formToRule(unnamed, "en", { requireName: false }).ok, true);
});

test("a saved rule round-trips through the form unchanged", () => {
  const rule: Rule = {
    ruleKey: 1,
    name: "Rent",
    active: true,
    match: "all",
    stopProcessing: true,
    position: 0,
    ownerAppuserKey: 1,
    conditions: [
      { field: "merchant", operator: "equals", value: "Landlord" },
      { field: "amount", operator: "between", min: 900.5, max: 1000 },
      { field: "currency", operator: "in", values: ["EUR"] },
      { field: "transactionType", operator: "in", values: ["PAYMENT"] },
    ],
    actions: [
      { type: "set_merchant", merchantId: 44 },
      { type: "set_notes", value: "Monthly rent" },
      { type: "mark_reviewed" },
    ],
  };

  const back = formToRule(ruleToForm(rule, "pt"), "pt");

  assert.equal(back.ok, true);
  assert.deepEqual(back.draft, {
    match: rule.match,
    conditions: rule.conditions,
    actions: rule.actions,
  });
});

test("switching a condition's field keeps text between text fields and resets the operator otherwise", () => {
  const text = {
    ...newCondition("description"),
    operator: "starts_with",
    value: "AMZN",
  };

  assert.deepEqual(changeConditionField(text, "merchant"), {
    ...text,
    field: "merchant",
  });
  const amount = changeConditionField(text, "amount");
  assert.equal(amount.operator, "eq");
  const direction = changeConditionField(text, "direction");
  assert.equal(direction.value, "out");
});

test("a rule from a transaction matches its merchant and keeps its category", () => {
  const transaction = {
    description: "NETFLIX.COM 123",
    descriptionDirty: "NETFLIX.COM 123 AMSTERDAM",
    transactionMerchantKey: { name: "Netflix" },
    appuserTransactionCategories: [{ categoryKey: 9 }],
  } as unknown as Transaction;

  const result = formToRule(formFromTransaction(transaction), "en");

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.name, "Netflix");
  assert.deepEqual(result.draft, {
    match: "all",
    conditions: [{ field: "merchant", operator: "equals", value: "Netflix" }],
    actions: [{ type: "set_category", categoryId: 9 }],
  });
});

test("a rule from a transaction without a merchant matches its description and asks for a category", () => {
  const transaction = {
    description: "TRF 0042 RENT",
    descriptionDirty: "TRF 0042 RENT",
    appuserTransactionCategories: [],
  } as unknown as Transaction;

  const state = formFromTransaction(transaction);
  const result = formToRule(state, "en");

  assert.deepEqual(
    state.conditions.map(({ field, operator, value }) => ({
      field,
      operator,
      value,
    })),
    [{ field: "description", operator: "contains", value: "TRF 0042 RENT" }],
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.ok ? null : Object.values(result.problems.actions), [
    "category-required",
  ]);
});

test("a rule suggestion becomes a new rule's form that converts back to the suggested rule", () => {
  const form = formFromSuggestion(
    {
      category: { categoryKey: 5, name: "Groceries" },
      fingerprint: "c".repeat(64),
      kind: "description",
      matchCount: 3,
      rule: {
        name: "COMPRA 1192 CONTINENTE",
        match: "all",
        stopProcessing: false,
        conditions: [
          {
            field: "description",
            operator: "contains",
            source: "cleaned",
            value: "CONTINENTE",
          },
        ],
        actions: [{ type: "set_category", categoryId: 5 }],
      },
      windowDays: 90,
    },
    "en",
  );

  assert.equal(form.name, "COMPRA 1192 CONTINENTE");
  assert.deepEqual(formToRule(form, "en"), {
    ok: true,
    name: "COMPRA 1192 CONTINENTE",
    draft: {
      match: "all",
      conditions: [
        {
          field: "description",
          operator: "contains",
          source: "cleaned",
          value: "CONTINENTE",
        },
      ],
      actions: [{ type: "set_category", categoryId: 5 }],
    },
  });
});
