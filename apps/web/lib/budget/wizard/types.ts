export type WizardIncomeRecurrency =
  | "MONTHLY"
  | "MONTHLY_14"
  | "QUARTERLY"
  | "ANNUALLY"
  | "BI_ANNUALLY";

export type WizardIncome = {
  id: string;
  name: string;
  amount: number;
  isRecurrent: boolean;
  recurrency?: WizardIncomeRecurrency;
};

export type StoredMonthlyEquivalentIncome = {
  name?: string;
  amount: number;
  recurrency?: WizardIncomeRecurrency | string;
};

export type BudgetStarterProfileKey =
  | "single"
  | "couple"
  | "family"
  | "freelancer"
  | "custom";

export type BudgetStarterProfileDefinition = {
  key: BudgetStarterProfileKey;
  labelKey: string;
  descriptionKey: string;
  usesHouseholdInputs: boolean;
};

export type BudgetStarterCategorySuggestion = {
  key: string;
  labelKey: string;
  group: string;
  monthlyAmount: number;
};

export type BudgetStarterSuggestionInput = {
  profileKey: BudgetStarterProfileKey;
  averageMonthlyIncome: number;
  householdSize?: number;
  dependentCount?: number;
};

export type BudgetStarterCategoryRowLike = {
  key: number;
  name: string;
  budgeted: number;
  subRows?: BudgetStarterCategoryRowLike[];
};

export type BudgetStarterCategorySuggestionChange = {
  categoryKey: string | number;
  amount: number;
};

export type BudgetStarterCategorySuggestionMatch = {
  categoryKey: string | number;
  amount: number;
};

export type BudgetStarterCategorySuggestionApplyResult<T extends BudgetStarterCategoryRowLike> = {
  rows: T[];
  matchedCount: number;
  matchedRows: BudgetStarterCategorySuggestionMatch[];
  changedCount: number;
  changedRows: BudgetStarterCategorySuggestionChange[];
};

export type ApplyBudgetStarterProfileToBudgetRowsInput<T extends BudgetStarterCategoryRowLike> = {
  rows: T[];
  profileKey: BudgetStarterProfileKey;
  averageMonthlyIncome: number;
  householdSize?: number;
  dependentCount?: number;
};

export type BudgetStarterCategoryTemplate = Omit<
  BudgetStarterCategorySuggestion,
  "monthlyAmount"
> & {
  incomeShare: number;
  householdShareAdjustment: number;
  dependentShareAdjustment: number;
};
