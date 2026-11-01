import assert from "node:assert/strict";

import { test } from "vitest";

import type { Category } from "../api/category/useCategories";
import {
  getCategoryDisplayName,
  getCategorySearchKeywords,
  getSelectableCategories,
} from "./categories";

const makeCategory = (
  category: Partial<Category> & Pick<Category, "categoryKey" | "name">,
): Category => ({
  bgColor: "#f3f3f3",
  categoryKey: category.categoryKey,
  childCategory: category.childCategory,
  icon: category.icon,
  isSystemCategory: category.isSystemCategory ?? false,
  name: category.name,
  textColor: "#030303",
});

test("getSelectableCategories includes custom parent categories and subcategories", () => {
  const categories: Category[] = [
    makeCategory({
      categoryKey: 1,
      isSystemCategory: true,
      name: "Other",
      childCategory: [
        makeCategory({ categoryKey: 2, isSystemCategory: true, name: "Gifts" }),
      ],
    }),
    makeCategory({
      categoryKey: 10,
      isSystemCategory: false,
      name: "Custom parent",
      childCategory: [
        makeCategory({ categoryKey: 11, name: "Custom child" }),
      ],
    }),
    makeCategory({
      categoryKey: 12,
      isSystemCategory: false,
      name: "Standalone custom",
    }),
  ];

  assert.deepEqual(
    getSelectableCategories(categories).map((category) => category.name),
    ["Gifts", "Custom parent", "Custom child", "Standalone custom"],
  );
});

test("getSelectableCategories keeps system parent headings out of transaction options", () => {
  const categories: Category[] = [
    makeCategory({
      categoryKey: 1,
      isSystemCategory: true,
      name: "Other",
      childCategory: [
        makeCategory({ categoryKey: 2, isSystemCategory: true, name: "Travel" }),
      ],
    }),
  ];

  assert.deepEqual(
    getSelectableCategories(categories).map((category) => category.name),
    ["Travel"],
  );
});

function makeTranslator(known: Record<string, string>) {
  const t = (key: string) => known[key] ?? key;
  t.has = (key: string) => key in known;
  return t;
}

test("getCategoryDisplayName translates a raw system-category key", () => {
  const t = makeTranslator({
    "categories.cafe-restaurants-bars": "Cafe, Restaurants & Bars",
  });

  assert.equal(
    getCategoryDisplayName(t, "CAFE_RESTAURANTS_BARS"),
    "Cafe, Restaurants & Bars",
  );
});

test("getCategoryDisplayName passes a user-defined category name through unchanged", () => {
  const t = makeTranslator({
    "categories.cafe-restaurants-bars": "Cafe, Restaurants & Bars",
  });

  assert.equal(getCategoryDisplayName(t, "My side hustle"), "My side hustle");
});

// The category picker's cmdk search must index more than the raw untranslated
// `category.name` enum (e.g. "STREAMING_SERVICES"), or a user searching the
// label they can actually see, or a common real-world synonym for it, finds
// nothing. `getCategorySearchKeywords` is the exact list wired
// into `CommandItem`'s `keywords` prop in CategorySelect.tsx.

test("getCategorySearchKeywords includes the translated label alongside the raw name", () => {
  assert.deepEqual(
    getCategorySearchKeywords("STREAMING_SERVICES", "Streaming Services"),
    ["STREAMING_SERVICES", "Streaming Services", "Subscription", "Subscriptions"],
  );
});

test('getCategorySearchKeywords finds Streaming Services when searching "Subscription"', () => {
  const keywords = getCategorySearchKeywords(
    "STREAMING_SERVICES",
    "Streaming Services",
  );

  assert(
    keywords.some((keyword) => /subscription/i.test(keyword)),
    "Streaming Services must be searchable by \"Subscription\"/\"Subscriptions\"",
  );
});

test('getCategorySearchKeywords finds Salary when searching "Income" or "Salary"', () => {
  const keywords = getCategorySearchKeywords("SALARY", "Salary");

  assert.deepEqual(keywords, ["SALARY", "Salary", "Income"]);
  assert(
    keywords.some((keyword) => /^income$/i.test(keyword)),
    '"Income" must resolve to the SALARY category — INCOME itself has no selectable row',
  );
  assert(
    keywords.some((keyword) => /^salary$/i.test(keyword)),
    'The translated label "Salary" must remain searchable',
  );
});

test("getCategorySearchKeywords is a no-op passthrough for categories with no synonym entry", () => {
  assert.deepEqual(getCategorySearchKeywords("GIFTS", "Gifts"), [
    "GIFTS",
    "Gifts",
  ]);
});

test("getCategorySearchKeywords de-duplicates when the raw name and label are identical", () => {
  assert.deepEqual(getCategorySearchKeywords("Custom category", "Custom category"), [
    "Custom category",
  ]);
});
