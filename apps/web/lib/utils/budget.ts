import { BudgetCategory } from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";
import type { BudgetRow, BudgetRowLike, BudgetSubRow } from "@/lib/budget/rows";

import {
  convertMonthlyAmountToAnuallizedMonthlyAmount,
  convertRecurrencyIntoMonthsInYear,
} from "./recurrency";

export const getMonthlyBudgetedValue = (row: BudgetRowLike) =>
  convertMonthlyAmountToAnuallizedMonthlyAmount(row.budgeted, row.recurrency);

/**
 * What the row may spend this month: its monthly plan (as the Planned column
 * shows it) plus what last month carried in. Equals the API's
 * `category_available` for a monthly row; for a parent or a non-monthly row
 * the plan part is the spread figure the screen shows, not the raw entered
 * amount the API adds to. Without rollover this is the plan.
 */
export const getMonthlyAvailableValue = (row: BudgetRowLike) =>
  getMonthlyBudgetedValue(row) + (row.rolledOver ?? 0);

/** What the row has left this month: available minus spent (negative when over). */
export const getBudgetRowRemaining = (row: BudgetRowLike) =>
  getMonthlyAvailableValue(row) - (row.spent ?? 0);

/**
 * Spent as a share of what the row may spend (1 = all of it). 0 when nothing
 * is available, so an empty plan never divides by zero.
 */
export const getBudgetRowProgress = (row: BudgetRowLike) => {
  const available = getMonthlyAvailableValue(row);
  return available === 0 ? 0 : (row.spent ?? 0) / available;
};

export const calculateParentBudgetedFromSubRows = (subRows: BudgetRowLike[]) =>
  subRows.reduce((sum, subRow) => sum + getMonthlyBudgetedValue(subRow), 0);

export const getBudgetRowMonthlyBudgetedTotal = (data: BudgetRowLike[]) => {
  return data.reduce((acc, row) => {
    if (row.subRows && row.subRows.length > 0) {
      return acc + calculateParentBudgetedFromSubRows(row.subRows);
    }

    return acc + getMonthlyBudgetedValue(row);
  }, 0);
};

const rolloverOf = (category: BudgetCategory) => ({
  rolledOver: category.category_rolled_over ?? 0,
  rolloverEnabled: category.category_rollover_enabled ?? false,
  rolloverIncomplete: category.category_rollover_incomplete ?? false,
});

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
        ...rolloverOf(category),
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
          ...rolloverOf(childCategory),
        };
        parentRow.subRows.push(childRow);
      }

      // The API's parent amount is the raw sum of its children, so a yearly
      // €600 counted as €600 a month. Plan what the children plan per month,
      // the same figure the footer total adds up.
      if (parentRow.subRows.length > 0) {
        parentRow.budgeted = calculateParentBudgetedFromSubRows(
          parentRow.subRows,
        );
        parentRow.recurrency = undefined;
      }
    }
  }

  return tableRows;
};

/**
 * The month's totals. `totalPlanned` is the plan alone (the Planned column's
 * sum); `totalAvailable` adds what rollover carried in, and is what remaining
 * and `totalPercentage` (remaining as a share of available) measure against.
 */
export const calculatePlannedAndSpentValue = (data: BudgetRowLike[]) => {
  const totalPlanned = getBudgetRowMonthlyBudgetedTotal(data);
  let totalSpent = 0;
  let totalRolledOver = 0;

  for (const row of data) {
    totalSpent += row.spent ?? 0;
    // A parent's carry is already the sum of its subcategories'.
    totalRolledOver += row.rolledOver ?? 0;
  }

  const totalAvailable = totalPlanned + totalRolledOver;

  return {
    totalPlanned,
    totalAvailable,
    totalSpent,
    totalPercentage:
      totalAvailable > 0
        ? ((totalAvailable - totalSpent) / totalAvailable) * 100
        : 0,
  };
};
