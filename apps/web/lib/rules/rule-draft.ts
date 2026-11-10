import type { Transaction } from "@/lib/api/account/useTransactions";
import {
  type ListOperator,
  type NumberOperator,
  type Rule,
  RULE_NAME_MAX_LENGTH,
  RULE_TEXT_MAX_LENGTH,
  type RuleAction,
  type RuleCondition,
  type RuleDraft,
  type RuleMatch,
  type TextOperator,
  UNCATEGORIZED,
} from "@/lib/api/rule/useRules";
import { formatLocaleNumberInput, parseLocaleNumber } from "@/lib/utils/number";

/**
 * The rule editor's form state, and its conversion to and from the API shape.
 *
 * The form keeps every row as strings (what the inputs hold), so switching a
 * row's field or operator never loses what was typed in the others. A rule is
 * sent, or previewed, only once every row converts.
 */

export type ConditionField = RuleCondition["field"];
export type ActionType = RuleAction["type"];

export const CONDITION_FIELDS: ConditionField[] = [
  "description",
  "merchant",
  "amount",
  "direction",
  "account",
  "category",
  "transactionType",
  "currency",
];

export const ACTION_TYPES: ActionType[] = [
  "set_category",
  "set_merchant",
  "set_description",
  "set_notes",
  "add_tags",
  "mark_reviewed",
  "hide",
];

export const TEXT_OPERATORS: TextOperator[] = [
  "contains",
  "not_contains",
  "equals",
  "starts_with",
  "ends_with",
];
export const AMOUNT_OPERATORS: (NumberOperator | "between")[] = [
  "eq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
];
export const LIST_OPERATORS: ListOperator[] = ["in", "not_in"];

export type ListField = "account" | "category" | "transactionType" | "currency";

export const isTextField = (field: ConditionField) =>
  field === "description" || field === "merchant";
export const isListField = (field: ConditionField): field is ListField =>
  field === "account" ||
  field === "category" ||
  field === "transactionType" ||
  field === "currency";

export interface ConditionDraft {
  id: string;
  field: ConditionField;
  /** A text, amount or list operator, by field; `is` for direction. */
  operator: string;
  source: "cleaned" | "raw";
  /** Text, a single amount, or the direction (`in`/`out`). */
  value: string;
  min: string;
  max: string;
  /** Account or category keys (or `uncategorized`), type names, currency codes. */
  values: string[];
}

export interface ActionDraft {
  id: string;
  type: ActionType;
  /** Category key, as a string. */
  categoryId: string;
  /**
   * The merchant's name. The API finds the household's merchant by name
   * (ignoring case and accents) and creates it only when there is none, so a
   * picked merchant and a typed new one travel the same way.
   */
  merchant: string;
  /** Kept from a rule saved with a merchant key, until another merchant is picked. */
  merchantId: number | null;
  /** Description or notes text. */
  value: string;
  tagIds: number[];
}

export interface RuleFormState {
  name: string;
  match: RuleMatch;
  stopProcessing: boolean;
  conditions: ConditionDraft[];
  actions: ActionDraft[];
}

let nextId = 0;
const rowId = () => `row-${++nextId}`;

export function defaultOperator(field: ConditionField): string {
  if (isTextField(field)) return "contains";
  if (field === "amount") return "eq";
  if (field === "direction") return "is";
  return "in";
}

export function newCondition(
  field: ConditionField = "description",
): ConditionDraft {
  return {
    id: rowId(),
    field,
    operator: defaultOperator(field),
    source: "cleaned",
    value: field === "direction" ? "out" : "",
    min: "",
    max: "",
    values: [],
  };
}

/** The same row on another field: the operator resets, typed values stay. */
export function changeConditionField(
  condition: ConditionDraft,
  field: ConditionField,
): ConditionDraft {
  if (condition.field === field) return condition;
  const sameKind =
    (isTextField(field) && isTextField(condition.field)) ||
    (isListField(field) && isListField(condition.field));
  return {
    ...condition,
    field,
    operator: sameKind ? condition.operator : defaultOperator(field),
    value:
      field === "direction"
        ? "out"
        : condition.field === "direction"
          ? ""
          : condition.value,
    values:
      isListField(field) && field === condition.field ? condition.values : [],
  };
}

export function newAction(type: ActionType = "set_category"): ActionDraft {
  return {
    id: rowId(),
    type,
    categoryId: "",
    merchant: "",
    merchantId: null,
    value: "",
    tagIds: [],
  };
}

export function emptyRuleForm(): RuleFormState {
  return {
    name: "",
    match: "all",
    stopProcessing: false,
    conditions: [newCondition()],
    actions: [newAction()],
  };
}

const formatAmount = (value: number, locale: string) =>
  formatLocaleNumberInput(value, locale);

/** A saved rule, as the editor's form state. */
export function ruleToForm(rule: Rule, locale: string): RuleFormState {
  return {
    name: rule.name,
    match: rule.match,
    stopProcessing: rule.stopProcessing,
    conditions: rule.conditions.map((condition) => {
      const row = newCondition(condition.field);
      row.operator = condition.operator;
      switch (condition.field) {
        case "description":
          return { ...row, source: condition.source, value: condition.value };
        case "merchant":
          return { ...row, value: condition.value };
        case "amount":
          return condition.operator === "between"
            ? {
                ...row,
                min: formatAmount(condition.min, locale),
                max: formatAmount(condition.max, locale),
              }
            : { ...row, value: formatAmount(condition.value, locale) };
        case "direction":
          return { ...row, value: condition.value };
        default:
          return { ...row, values: condition.values.map(String) };
      }
    }),
    actions: rule.actions.map((action) => {
      const row = newAction(action.type);
      switch (action.type) {
        case "set_category":
          return { ...row, categoryId: String(action.categoryId) };
        case "set_merchant":
          return "merchantId" in action
            ? { ...row, merchantId: action.merchantId }
            : { ...row, merchant: action.merchantName };
        case "set_description":
        case "set_notes":
          return { ...row, value: action.value };
        case "add_tags":
          return { ...row, tagIds: action.tagIds };
        default:
          return row;
      }
    }),
  };
}

/** Why a row cannot be sent yet, as a message key under `rules.errors`. */
export type RowProblem =
  | "value-required"
  | "value-too-long"
  | "amount-invalid"
  | "range-invalid"
  | "values-required"
  | "category-required"
  | "merchant-required"
  | "tags-required";

export interface FormProblems {
  name?: "name-required";
  conditions: Record<string, RowProblem>;
  actions: Record<string, RowProblem>;
  /** The same kind of action twice. */
  duplicateActions: boolean;
}

export type FormConversion =
  | { ok: true; draft: RuleDraft; name: string }
  | { ok: false; problems: FormProblems; draft: null };

const AMOUNT_DECIMALS = 4;

function parseAmount(value: string, locale: string): number | null {
  const parsed = parseLocaleNumber(value.trim(), locale);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return null;
  const scaled = parsed * 10 ** AMOUNT_DECIMALS;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return null;
  return parsed;
}

function toText(value: string): string | RowProblem {
  const text = value.trim();
  if (text.length === 0) return "value-required";
  if (text.length > RULE_TEXT_MAX_LENGTH) return "value-too-long";
  return text;
}

function toCondition(
  row: ConditionDraft,
  locale: string,
): RuleCondition | RowProblem {
  if (isTextField(row.field)) {
    const value = toText(row.value);
    if (value === "value-required" || value === "value-too-long") return value;
    const operator = row.operator as TextOperator;
    return row.field === "description"
      ? { field: "description", operator, source: row.source, value }
      : { field: "merchant", operator, value };
  }
  if (row.field === "amount") {
    if (row.operator === "between") {
      const min = parseAmount(row.min, locale);
      const max = parseAmount(row.max, locale);
      if (min === null || max === null) return "amount-invalid";
      if (min > max) return "range-invalid";
      return { field: "amount", operator: "between", min, max };
    }
    const value = parseAmount(row.value, locale);
    if (value === null) return "amount-invalid";
    return {
      field: "amount",
      operator: row.operator as NumberOperator,
      value,
    };
  }
  if (row.field === "direction") {
    return {
      field: "direction",
      operator: "is",
      value: row.value === "in" ? "in" : "out",
    };
  }
  if (row.values.length === 0) return "values-required";
  const operator = row.operator as ListOperator;
  switch (row.field) {
    case "account":
      return { field: "account", operator, values: row.values.map(Number) };
    case "category":
      return {
        field: "category",
        operator,
        values: row.values.map((value) =>
          value === UNCATEGORIZED ? UNCATEGORIZED : Number(value),
        ),
      };
    case "transactionType":
      return { field: "transactionType", operator, values: row.values };
    default:
      return { field: "currency", operator, values: row.values };
  }
}

function toAction(row: ActionDraft): RuleAction | RowProblem {
  switch (row.type) {
    case "set_category":
      return row.categoryId
        ? { type: "set_category", categoryId: Number(row.categoryId) }
        : "category-required";
    case "set_merchant": {
      if (!row.merchant.trim() && row.merchantId !== null) {
        return { type: "set_merchant", merchantId: row.merchantId };
      }
      const name = toText(row.merchant);
      if (name === "value-required") return "merchant-required";
      if (name === "value-too-long") return name;
      return { type: "set_merchant", merchantName: name };
    }
    case "set_description":
    case "set_notes": {
      const value = toText(row.value);
      if (value === "value-required" || value === "value-too-long")
        return value;
      return { type: row.type, value };
    }
    case "add_tags":
      return row.tagIds.length > 0
        ? { type: "add_tags", tagIds: row.tagIds }
        : "tags-required";
    case "mark_reviewed":
      return { type: "mark_reviewed" };
    case "hide":
      return { type: "hide" };
  }
}

const isProblem = (value: unknown): value is RowProblem =>
  typeof value === "string";

/**
 * The form as an API rule, or what stops it. The name is checked only when
 * `requireName` (a preview does not need one).
 */
export function formToRule(
  form: RuleFormState,
  locale: string,
  { requireName = true }: { requireName?: boolean } = {},
): FormConversion {
  const problems: FormProblems = {
    conditions: {},
    actions: {},
    duplicateActions: false,
  };
  const conditions: RuleCondition[] = [];
  const actions: RuleAction[] = [];
  for (const row of form.conditions) {
    const condition = toCondition(row, locale);
    if (isProblem(condition)) problems.conditions[row.id] = condition;
    else conditions.push(condition);
  }
  for (const row of form.actions) {
    const action = toAction(row);
    if (isProblem(action)) problems.actions[row.id] = action;
    else actions.push(action);
  }
  const types = form.actions.map((row) => row.type);
  problems.duplicateActions = new Set(types).size !== types.length;
  const name = form.name.trim().slice(0, RULE_NAME_MAX_LENGTH);
  if (requireName && name.length === 0) problems.name = "name-required";

  const failed =
    problems.name !== undefined ||
    problems.duplicateActions ||
    Object.keys(problems.conditions).length > 0 ||
    Object.keys(problems.actions).length > 0 ||
    conditions.length === 0 ||
    actions.length === 0;
  if (failed) return { ok: false, problems, draft: null };
  return { ok: true, draft: { match: form.match, conditions, actions }, name };
}

/**
 * A rule for transactions like this one: the same merchant (or, without one,
 * a description containing this one's), set to its current category.
 */
export function formFromTransaction(transaction: Transaction): RuleFormState {
  const merchant = transaction.transactionMerchantKey?.name?.trim();
  const description = (
    transaction.description ||
    transaction.descriptionDirty ||
    ""
  ).trim();
  const condition = merchant
    ? { ...newCondition("merchant"), operator: "equals", value: merchant }
    : { ...newCondition("description"), value: description };
  const category = transaction.appuserTransactionCategories?.[0];
  return {
    name: (merchant || description).slice(0, RULE_NAME_MAX_LENGTH),
    match: "all",
    stopProcessing: false,
    conditions: [condition],
    actions: [
      {
        ...newAction("set_category"),
        categoryId: category ? String(category.categoryKey) : "",
      },
    ],
  };
}
