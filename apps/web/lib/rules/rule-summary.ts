import type { Rule, RuleAction, RuleCondition } from "@/lib/api/rule/useRules";
import { UNCATEGORIZED } from "@/lib/api/rule/useRules";

/**
 * A rule in one line, for the rules list: "Description contains NETFLIX, set
 * category Entertainment". Names come from the lookups (a category, account or
 * tag that is gone reads as "unknown"); words from the `rules` messages.
 */

/** A next-intl translator scoped to the `rules` namespace. */
export type RulesTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface SummaryLookups {
  category: (categoryKey: number) => string | undefined;
  account: (accountKey: number) => string | undefined;
  tag: (tagKey: number) => string | undefined;
  transactionType: (name: string) => string;
  amount: (value: number) => string;
}

const MAX_LISTED = 3;

function list(t: RulesTranslator, names: string[]): string {
  if (names.length <= MAX_LISTED) return names.join(", ");
  return t("summary.list-more", {
    names: names.slice(0, MAX_LISTED).join(", "),
    count: names.length - MAX_LISTED,
  });
}

export function summarizeCondition(
  condition: RuleCondition,
  t: RulesTranslator,
  lookups: SummaryLookups,
): string {
  const unknown = t("summary.unknown");
  switch (condition.field) {
    case "description":
    case "merchant":
      return t("summary.text-condition", {
        field: t(
          condition.field === "description" && condition.source === "raw"
            ? "fields.rawDescription"
            : `fields.${condition.field}`,
        ),
        operator: t(`operators.${condition.operator}`),
        value: condition.value,
      });
    case "amount":
      return condition.operator === "between"
        ? t("summary.amount-between", {
            min: lookups.amount(condition.min),
            max: lookups.amount(condition.max),
          })
        : t("summary.amount-condition", {
            operator: t(`operators.${condition.operator}`),
            value: lookups.amount(condition.value),
          });
    case "direction":
      return t(`summary.direction-${condition.value}`);
    default: {
      const names = (condition.values as (number | string)[]).map((value) => {
        switch (condition.field) {
          case "account":
            return lookups.account(Number(value)) ?? unknown;
          case "category":
            return value === UNCATEGORIZED
              ? t("uncategorized")
              : (lookups.category(Number(value)) ?? unknown);
          case "transactionType":
            return lookups.transactionType(String(value));
          default:
            return String(value);
        }
      });
      return t("summary.list-condition", {
        field: t(`fields.${condition.field}`),
        operator: t(`operators.${condition.operator}`),
        values: list(t, names),
      });
    }
  }
}

export function summarizeAction(
  action: RuleAction,
  t: RulesTranslator,
  lookups: SummaryLookups,
): string {
  const unknown = t("summary.unknown");
  switch (action.type) {
    case "set_category":
      return t("summary.set_category", {
        name: lookups.category(action.categoryId) ?? unknown,
      });
    case "set_merchant":
      return "merchantName" in action
        ? t("summary.set_merchant", { name: action.merchantName })
        : t("summary.set_merchant-saved");
    case "set_description":
    case "set_notes":
      return t(`summary.${action.type}`, { value: action.value });
    case "add_tags":
      return t("summary.add_tags", {
        names: list(
          t,
          action.tagIds.map((key) => lookups.tag(key) ?? unknown),
        ),
      });
    default:
      return t(`summary.${action.type}`);
  }
}

export function summarizeRule(
  rule: Pick<Rule, "conditions" | "actions" | "match">,
  t: RulesTranslator,
  lookups: SummaryLookups,
): string {
  const joiner = ` ${t(rule.match === "any" ? "summary.or" : "summary.and")} `;
  const conditions = rule.conditions
    .map((condition) => summarizeCondition(condition, t, lookups))
    .join(joiner);
  const actions = rule.actions
    .map((action) => summarizeAction(action, t, lookups))
    .join(", ");
  return `${conditions}, ${actions}`;
}

/** The category a rule sets, for filtering the list by target category. */
export function targetCategory(rule: Pick<Rule, "actions">): number | null {
  const action = rule.actions.find(
    (candidate) => candidate.type === "set_category",
  );
  return action?.type === "set_category" ? action.categoryId : null;
}
