import type { Category } from "@/lib/api/category/useCategories";

// Enhanced category type for UI components with additional properties
export interface CategoryWithUI extends Omit<Category, "childCategory"> {
  subRows: CategoryWithUI[];
  parentCategoryKey?: number | null;
}

// Type for transforming API data to UI data
export function transformCategoryToUI(
  category: Category,
  parentKey?: number | null,
): CategoryWithUI {
  return {
    name: category.name,
    categoryKey: category.categoryKey,
    textColor: category.textColor,
    bgColor: category.bgColor,
    icon: category.icon,
    isSystemCategory: category.isSystemCategory,
    subRows:
      category.childCategory?.map((child) => ({
        ...child,
        subRows: [],
        parentCategoryKey: category.categoryKey,
      })) || [],
    parentCategoryKey: parentKey || null,
  };
}
