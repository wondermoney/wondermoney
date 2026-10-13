import type {
  BudgetStarterCategorySuggestion,
  BudgetStarterCategoryTemplate,
  BudgetStarterProfileDefinition,
  BudgetStarterProfileKey,
  BudgetStarterSuggestionInput,
} from "./types";

export const BUDGET_STARTER_PROFILES: BudgetStarterProfileDefinition[] = [
  { key: "single", labelKey: "budget-starter-profile-single", descriptionKey: "budget-starter-profile-single-description", usesHouseholdInputs: false },
  { key: "couple", labelKey: "budget-starter-profile-couple", descriptionKey: "budget-starter-profile-couple-description", usesHouseholdInputs: true },
  { key: "family", labelKey: "budget-starter-profile-family", descriptionKey: "budget-starter-profile-family-description", usesHouseholdInputs: true },
  { key: "freelancer", labelKey: "budget-starter-profile-freelancer", descriptionKey: "budget-starter-profile-freelancer-description", usesHouseholdInputs: true },
  { key: "custom", labelKey: "budget-starter-profile-custom", descriptionKey: "budget-starter-profile-custom-description", usesHouseholdInputs: false },
];

const starterProfileCategoryTemplates: Record<
  Exclude<BudgetStarterProfileKey, "custom">,
  BudgetStarterCategoryTemplate[]
> = {
  single: [categoryTemplate("housing", "essentials", 0.35), categoryTemplate("groceries", "essentials", 0.14), categoryTemplate("transport", "essentials", 0.08), categoryTemplate("utilities", "essentials", 0.08), categoryTemplate("subscriptions", "lifestyle", 0.04), categoryTemplate("dining", "lifestyle", 0.08), categoryTemplate("health", "essentials", 0.05), categoryTemplate("savings-buffer", "planning", 0.1), categoryTemplate("other-spending", "flexible", 0.08)],
  couple: [categoryTemplate("housing", "essentials", 0.34), categoryTemplate("groceries", "essentials", 0.16, 0.01), categoryTemplate("transport", "essentials", 0.09, 0.005), categoryTemplate("utilities", "essentials", 0.08, 0.005), categoryTemplate("insurance", "planning", 0.05), categoryTemplate("subscriptions", "lifestyle", 0.04), categoryTemplate("dining", "lifestyle", 0.07), categoryTemplate("savings-buffer", "planning", 0.1), categoryTemplate("other-spending", "flexible", 0.07)],
  family: [categoryTemplate("housing", "essentials", 0.32), categoryTemplate("groceries", "essentials", 0.17, 0.01, 0.015), categoryTemplate("transport", "essentials", 0.09, 0.005, 0.005), categoryTemplate("utilities", "essentials", 0.08, 0.005), categoryTemplate("childcare-education", "dependents", 0.08, 0, 0.02), categoryTemplate("health", "essentials", 0.05, 0, 0.005), categoryTemplate("insurance", "planning", 0.05), categoryTemplate("subscriptions", "lifestyle", 0.03), categoryTemplate("dining", "lifestyle", 0.05), categoryTemplate("family-activities", "lifestyle", 0.04), categoryTemplate("savings-buffer", "planning", 0.08), categoryTemplate("other-spending", "flexible", 0.06)],
  freelancer: [categoryTemplate("housing", "essentials", 0.3), categoryTemplate("groceries", "essentials", 0.13, 0.01), categoryTemplate("transport", "essentials", 0.07), categoryTemplate("utilities", "essentials", 0.07), categoryTemplate("subscriptions", "lifestyle", 0.04), categoryTemplate("taxes-buffer", "planning", 0.15), categoryTemplate("business-tools", "work", 0.04), categoryTemplate("professional-services", "work", 0.03), categoryTemplate("health", "essentials", 0.05), categoryTemplate("savings-buffer", "planning", 0.08), categoryTemplate("other-spending", "flexible", 0.04)],
};

function categoryTemplate(
  key: string,
  group: string,
  incomeShare: number,
  householdShareAdjustment = 0,
  dependentShareAdjustment = 0,
): BudgetStarterCategoryTemplate {
  return {
    key,
    labelKey: `budget-starter-category-${key}`,
    group,
    incomeShare,
    householdShareAdjustment,
    dependentShareAdjustment,
  };
}

export function getBudgetStarterCategorySuggestions({
  profileKey,
  averageMonthlyIncome,
  householdSize = 1,
  dependentCount = 0,
}: BudgetStarterSuggestionInput): BudgetStarterCategorySuggestion[] {
  if (profileKey === "custom" || averageMonthlyIncome <= 0) {
    return [];
  }

  const templates = starterProfileCategoryTemplates[profileKey];
  const safeHouseholdSize = Math.max(1, householdSize);
  const safeDependentCount = Math.max(0, dependentCount);
  const extraHouseholdMembers = Math.max(0, safeHouseholdSize - 1);

  const suggestions = templates.map((template) => ({
    key: template.key,
    labelKey: template.labelKey,
    group: template.group,
    monthlyAmount: roundCurrency(
      averageMonthlyIncome *
        (template.incomeShare +
          template.householdShareAdjustment * extraHouseholdMembers +
          template.dependentShareAdjustment * safeDependentCount),
    ),
  }));

  return capSuggestionsToIncome(suggestions, averageMonthlyIncome);
}

export function calculateStarterProfileMonthlyTotal(
  suggestions: BudgetStarterCategorySuggestion[],
) {
  return roundCurrency(
    suggestions.reduce((acc, suggestion) => acc + suggestion.monthlyAmount, 0),
  );
}

function capSuggestionsToIncome(
  suggestions: BudgetStarterCategorySuggestion[],
  averageMonthlyIncome: number,
) {
  let remainingIncome = roundCurrency(averageMonthlyIncome);

  return suggestions.map((suggestion) => {
    const monthlyAmount = Math.min(suggestion.monthlyAmount, remainingIncome);
    remainingIncome = roundCurrency(remainingIncome - monthlyAmount);

    return { ...suggestion, monthlyAmount };
  });
}

function roundCurrency(amount: number) {
  return Math.round(amount * 100) / 100;
}
