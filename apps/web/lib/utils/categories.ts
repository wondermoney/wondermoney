import type { Category } from "../api/category/useCategories";

export const getParentCategory = (
  allCategories: Category[],
  categoryKeyStr: string,
): Category | undefined => {
  const categoryKey = Number.parseInt(categoryKeyStr, 10);
  const category = allCategories.find((category) =>
    category.childCategory?.find((c) => c.categoryKey === categoryKey),
  );
  return category;
};

export const getSiblingCategories = (
  allCategories: Category[],
  categoryKeyStr: string,
) => {
  const categoryKey = Number.parseInt(categoryKeyStr, 10);
  const parentCategory = getParentCategory(allCategories, categoryKeyStr);
  if (!parentCategory) {
    return [];
  }
  return parentCategory.childCategory?.filter(
    (c) => c.categoryKey !== categoryKey,
  );
};

export const addParentCategory = (
  allCategories: Category[],
  currentCategories: string[],
  newCategoryStr: string,
): string[] => {
  const parentCategory = getParentCategory(allCategories, newCategoryStr);
  if (parentCategory) {
    const alreadyHasParent = currentCategories.find(
      (c) => c === parentCategory.categoryKey.toString(),
    );
    if (!alreadyHasParent) {
      return [...currentCategories, parentCategory.categoryKey.toString()];
    }
  }
  return currentCategories;
};

export const removeParentCategory = (
  allCategories: Category[],
  currentCategories: string[],
  removedCategoryStr: string,
): string[] => {
  const parentCategory = getParentCategory(allCategories, removedCategoryStr);
  if (parentCategory) {
    const siblingCategoryKeys =
      getSiblingCategories(allCategories, removedCategoryStr)?.map((s) =>
        s.categoryKey.toString(),
      ) ?? [];
    const hasSiblingCategories = currentCategories.some((c) =>
      siblingCategoryKeys.includes(c),
    );
    if (!hasSiblingCategories) {
      return currentCategories.filter(
        (categoryKey) => categoryKey !== parentCategory.categoryKey.toString(),
      );
    }
  }
  return currentCategories;
};

export const getAllCategoryKeys = (categories: Category[]): string[] => {
  const categoryKeys: string[] = [];
  for (const category of categories) {
    categoryKeys.push(category.categoryKey.toString());
    if (category.childCategory) {
      for (const childCategory of category.childCategory) {
        categoryKeys.push(childCategory.categoryKey.toString());
      }
    }
  }
  return categoryKeys;
};

export const getAllCategories = (
  categories: Category[],
): {
  key: Category["categoryKey"];
  name: Category["name"];
  isSystemCategory: Category["isSystemCategory"];
}[] => {
  const _categories: {
    key: Category["categoryKey"];
    name: Category["name"];
    isSystemCategory: Category["isSystemCategory"];
  }[] = [];
  _categories.push({
    key: 0,
    name: "Uncategorized",
    isSystemCategory: true,
  });
  for (const category of categories) {
    _categories.push({
      key: category.categoryKey,
      name: category.name,
      isSystemCategory: category.isSystemCategory,
    });
    if (category.childCategory) {
      for (const childCategory of category.childCategory) {
        _categories.push({
          key: childCategory.categoryKey,
          name: childCategory.name,
          isSystemCategory: childCategory.isSystemCategory,
        });
      }
    }
  }
  return _categories;
};

export const getSelectableCategoriesForGroup = (
  category: Category,
): Category[] => [
  ...(!category.isSystemCategory ? [category] : []),
  ...(category.childCategory ?? []),
];

export const getSelectableCategories = (categories: Category[]): Category[] =>
  categories.flatMap(getSelectableCategoriesForGroup);

export const getCategoryTranslationKey = (category: Category["name"]) => {
  return `categories.${category
    .replaceAll(", ", "-")
    .replaceAll(" ", "-")
    .replaceAll("_", "-")
    .replaceAll("&", "and")
    .toLowerCase()}`;
};

/**
 * Resolves a category's localized display name from a raw name, the shape
 * report endpoints hand back (the DB `name` column, e.g. the system-category
 * enum key `CAFE_RESTAURANTS_BARS` rather than "Cafe, Restaurants & Bars").
 *
 * Mirrors `CategorySelect`'s `t(getCategoryTranslationKey(name))` path so
 * report charts show the same names as the category picker/budget pages
 * instead of inventing a second mapping (RAD-645). `t.has` guards a
 * user-defined category name (never a translation key) so it passes through
 * unchanged rather than rendering a missing-message fallback.
 */
export function getCategoryDisplayName(
  t: { has: (key: string) => boolean; (key: string): string },
  name: string,
): string {
  const key = getCategoryTranslationKey(name);
  return t.has(key) ? t(key) : name;
}

/**
 * Small, hand-maintained list of common real-world search terms that share no
 * character sequence with a category's raw name or translated label, so
 * cmdk's fuzzy `command-score` matcher can never surface them on its own
 * (RAD-665, follow-up to the api-side RAD-646).
 *
 * Keyed by the category's raw (untranslated) `name` as stored on the row —
 * e.g. `"STREAMING_SERVICES"`, not the localized label shown to the user.
 * Keep this a lookup table, not a fuzzy-search rewrite: add an entry only
 * when a real user search term has no character overlap with the category's
 * name or label.
 */
export const CATEGORY_SEARCH_SYNONYMS: Record<string, string[]> = {
  // "Streaming Services" / "STREAMING_SERVICES" contain no "Subscription".
  STREAMING_SERVICES: ["Subscription", "Subscriptions"],
  // "SALARY" is the only selectable category under the (non-selectable)
  // "INCOME" parent, so a user searching "Income" needs an explicit alias.
  SALARY: ["Income"],
  // "Vehicle Maintenance"/"Vehicle Insurance" contain no "Car", the far more
  // common everyday term for either.
  VEHICLE_MAINTENANCE: ["Car"],
  VEHICLE_INSURANCE: ["Car"],
  // "Gym & Sports" contains no "Fitness".
  GYM_AND_SPORTS: ["Fitness"],
};

/**
 * Builds the full set of cmdk search keywords for a category item: the raw
 * name (kept so existing coincidental matches don't regress), the
 * translated/localized label actually shown to the user, and any
 * hand-written synonyms for that category name. See RAD-665.
 */
export const getCategorySearchKeywords = (
  categoryName: Category["name"],
  translatedLabel: string,
): string[] => {
  const keywords = new Set<string>([categoryName, translatedLabel]);
  for (const synonym of CATEGORY_SEARCH_SYNONYMS[categoryName] ?? []) {
    keywords.add(synonym);
  }
  return Array.from(keywords);
};
