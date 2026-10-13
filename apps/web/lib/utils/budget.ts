import { BudgetCategory } from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";
import type { BudgetRow, BudgetRowLike, BudgetSubRow } from "@/lib/budget/rows";

import {
  convertMonthlyAmountToAnuallizedMonthlyAmount,
  convertRecurrencyIntoMonthsInYear,
} from "./recurrency";

export const getMonthlyBudgetedValue = (row: BudgetRowLike) =>
  convertMonthlyAmountToAnuallizedMonthlyAmount(row.budgeted, row.recurrency);

export const calculateParentBudgetedFromSubRows = (
  subRows: BudgetRowLike[],
) => subRows.reduce((sum, subRow) => sum + getMonthlyBudgetedValue(subRow), 0);

export const getBudgetRowMonthlyBudgetedTotal = (data: BudgetRowLike[]) => {
  return data.reduce((acc, row) => {
    if (row.subRows && row.subRows.length > 0) {
      return acc + calculateParentBudgetedFromSubRows(row.subRows);
    }

    return acc + getMonthlyBudgetedValue(row);
  }, 0);
};

export const convertBudgetTemplatesIntoRows = (
  categories: BudgetCategory[],
) => {
  // Group child categories by parent category name
  const childCategoriesByParent: Record<string, BudgetCategory[]> = {};
  for (const category of categories) {
    if (category.child_category_name !== null) {
      const parentName = category.parent_category_name;
      childCategoriesByParent[parentName] =
        childCategoriesByParent[parentName] || [];
      childCategoriesByParent[parentName].push(category);
    }
  }

  // Create parent rows and child rows, using the childCategoriesByParent map
  const tableRows: BudgetRow[] = [];
  for (const category of categories) {
    const isParentCategory = category.child_category_name === null;
    const categoryName =
      category.child_category_name || category.parent_category_name;

    if (isParentCategory) {
      const parentRow: BudgetRow = {
        key: category.category_key,
        name: categoryName,
        budgeted: category.category_budgeted_amount,
        recurrency: category.category_recurrency
          ? convertRecurrencyIntoMonthsInYear(category.category_recurrency)
          : undefined,
        spent: category.category_amount,
        icon: category.category_icon,
        textColor: category.category_text_color,
        bgColor: category.category_bg_color,
        isSystemCategory: category.category_is_system_category,
        subRows: [],
      };
      tableRows.push(parentRow);

      const childCategories = childCategoriesByParent[categoryName] || [];
      for (const childCategory of childCategories) {
        const childRow: BudgetSubRow = {
          key: childCategory.category_key,
          name: childCategory.child_category_name ?? "",
          budgeted: childCategory.category_budgeted_amount,
          recurrency: childCategory.category_recurrency
            ? convertRecurrencyIntoMonthsInYear(
                childCategory.category_recurrency,
              )
            : 12,
          spent: childCategory.category_amount,
          icon: childCategory.category_icon,
          textColor: childCategory.category_text_color,
          bgColor: childCategory.category_bg_color,
          isSystemCategory: childCategory.category_is_system_category,
        };
        parentRow.subRows.push(childRow);
      }
    }
  }

  return tableRows;
};

export const calculatePlannedAndSpentValue = (data: BudgetRow[]) => {
  const totalPlanned = getBudgetRowMonthlyBudgetedTotal(data);
  let totalSpent = 0;

  for (const row of data) {
    totalSpent += row.spent ?? 0;
  }

  return {
    totalPlanned,
    totalSpent,
    totalPercentage:
      totalPlanned > 0 ? ((totalPlanned - totalSpent) / totalPlanned) * 100 : 0,
  };
};
