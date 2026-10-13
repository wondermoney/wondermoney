import { calculateParentBudgetedFromSubRows } from "@/lib/utils/budget";
import { getCategoryTranslationKey } from "@/lib/utils/categories";

import { getBudgetStarterCategorySuggestions } from "./profiles";
import type {
  ApplyBudgetStarterProfileToBudgetRowsInput,
  BudgetStarterCategoryRowLike,
  BudgetStarterCategorySuggestion,
  BudgetStarterCategorySuggestionApplyResult,
  BudgetStarterCategorySuggestionChange,
  BudgetStarterCategorySuggestionMatch,
} from "./types";

const starterSuggestionCategoryTargetNames: Record<string, readonly string[]> = { housing: ["rent-mortgage"], groceries: ["groceries"], transport: ["fuel"], utilities: ["electricity"], subscriptions: ["streaming-services"], dining: ["cafe-restaurants-bars"], health: ["health"], "savings-buffer": ["savings"], insurance: ["insurance"], "childcare-education": ["education"], "family-activities": ["leisure"], "taxes-buffer": ["taxes-and-government-fees"], "business-tools": ["accounting-and-financial-planning"], "professional-services": ["consulting-and-legal"] };

export function applyBudgetStarterCategorySuggestionsToBudgetRows<
  T extends BudgetStarterCategoryRowLike,
>(
  rows: T[],
  suggestions: BudgetStarterCategorySuggestion[],
): BudgetStarterCategorySuggestionApplyResult<T> {
  if (suggestions.length === 0 || rows.length === 0) {
    return { rows, matchedCount: 0, matchedRows: [], changedCount: 0, changedRows: [] };
  }

  const suggestionsByTargetName = new Map<string, number>();
  for (const suggestion of suggestions) {
    const targetNames = starterSuggestionCategoryTargetNames[suggestion.key];
    if (!targetNames) continue;
    for (const targetName of targetNames) suggestionsByTargetName.set(targetName, suggestion.monthlyAmount);
  }

  const editableLeafCounts = new Map<string, number>();
  const collectEditableLeafCounts = (nextRows: T[], depth = 0) => {
    for (const row of nextRows) {
      const hasChildren = !!row.subRows?.length;
      if (hasChildren) { collectEditableLeafCounts(row.subRows as T[], depth + 1); continue; }
      if (depth === 0) continue;
      const normalizedRowName = getCategoryTranslationKey(row.name).replace(/^categories\./, "");
      editableLeafCounts.set(normalizedRowName, (editableLeafCounts.get(normalizedRowName) ?? 0) + 1);
    }
  };

  collectEditableLeafCounts(rows);

  const mapRows = (nextRows: T[], depth = 0): [T[], number, BudgetStarterCategorySuggestionMatch[], number, BudgetStarterCategorySuggestionChange[]] => {
    let changedCount = 0;
    let matchedCount = 0;
    const matchedRows: BudgetStarterCategorySuggestionMatch[] = [];
    const changedRows: BudgetStarterCategorySuggestionChange[] = [];

    const mappedRows = nextRows.map((row) => {
      const hasChildren = !!row.subRows?.length;
      const [mappedSubRows, subRowsMatchedCount, subRowsMatchedRows, subRowsChangedCount, subRowsChangedRows] = hasChildren ? mapRows(row.subRows as T[], depth + 1) : [row.subRows ?? [], 0, [] as BudgetStarterCategorySuggestionMatch[], 0, [] as BudgetStarterCategorySuggestionChange[]];

      matchedCount += subRowsMatchedCount;
      matchedRows.push(...subRowsMatchedRows);
      changedCount += subRowsChangedCount;
      changedRows.push(...subRowsChangedRows);

      const normalizedRowName = getCategoryTranslationKey(row.name).replace(/^categories\./, "");
      const suggestedAmount = suggestionsByTargetName.get(normalizedRowName);
      const isEditableRow = depth > 0 && !hasChildren;
      const hasUniqueEditableMatch = (editableLeafCounts.get(normalizedRowName) ?? 0) === 1;
      const shouldUpdateAmount = isEditableRow && hasUniqueEditableMatch && suggestedAmount !== undefined && row.budgeted !== suggestedAmount;
      const didMatchEditableRow = isEditableRow && hasUniqueEditableMatch && suggestedAmount !== undefined;

      if (didMatchEditableRow) { matchedCount += 1; matchedRows.push({ categoryKey: row.key, amount: row.budgeted }); }
      if (shouldUpdateAmount) { changedCount += 1; changedRows.push({ categoryKey: row.key, amount: suggestedAmount }); }

      if (!shouldUpdateAmount && subRowsChangedCount === 0) return row;

      return { ...row, budgeted: hasChildren ? calculateParentBudgetedFromSubRows(mappedSubRows) : shouldUpdateAmount ? suggestedAmount : row.budgeted, subRows: hasChildren ? mappedSubRows : row.subRows };
    });

    return [mappedRows, matchedCount, matchedRows, changedCount, changedRows];
  };

  const [mappedRows, matchedCount, matchedRows, changedCount, changedRows] = mapRows(rows);

  return changedCount > 0 ? { rows: mappedRows, matchedCount, matchedRows, changedCount, changedRows } : { rows, matchedCount, matchedRows, changedCount: 0, changedRows };
}

export function applyBudgetStarterProfileToBudgetRows<T extends BudgetStarterCategoryRowLike>({
  rows,
  profileKey,
  averageMonthlyIncome,
  householdSize,
  dependentCount,
}: ApplyBudgetStarterProfileToBudgetRowsInput<T>) {
  const suggestions = getBudgetStarterCategorySuggestions({ profileKey, averageMonthlyIncome, householdSize, dependentCount });
  return { suggestions, ...applyBudgetStarterCategorySuggestionsToBudgetRows(rows, suggestions) };
}
