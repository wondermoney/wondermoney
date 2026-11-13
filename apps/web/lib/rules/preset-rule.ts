import type { RulePresetRule } from "@/lib/api/rule/useRulePresets";

export interface PresetRuleParts {
  /** Text the bank's description (or merchant) must contain. */
  matches: string[];
  /** Text it must not contain. */
  excludes: string[];
  /** The system category key the rule sets, such as `GROCERIES`. */
  category?: string;
  merchant?: string;
  description?: string;
}

/** What a preset rule looks for and what it sets, for a one-line preview. */
export function presetRuleParts(rule: RulePresetRule): PresetRuleParts {
  const parts: PresetRuleParts = { matches: [], excludes: [] };
  for (const condition of rule.conditions) {
    if (
      (condition.field !== "description" && condition.field !== "merchant") ||
      typeof condition.value !== "string"
    )
      continue;
    if (condition.operator === "not_contains")
      parts.excludes.push(condition.value);
    else parts.matches.push(condition.value);
  }
  for (const action of rule.actions) {
    if (action.type === "set_category" && "system" in action.category)
      parts.category = action.category.system;
    if (action.type === "set_merchant") parts.merchant = action.merchant;
    if (action.type === "set_description") parts.description = action.value;
  }
  return parts;
}
