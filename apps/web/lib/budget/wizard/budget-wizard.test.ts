import assert from "node:assert/strict";

import { test } from "vitest";

import {
  applyBudgetStarterCategorySuggestionsToBudgetRows,
  applyBudgetStarterProfileToBudgetRows,
  calculateAverageMonthlyIncome,
  calculateStarterProfileMonthlyTotal,
  calculateStoredMonthlyEquivalentAnnualIncome,
  getBudgetStarterCategorySuggestions,
  replaceIncomeById,
  shouldAddCreatedCategoryToBudget,
  toBudgetCreateIncomes,
} from ".";

test("wizard income calculations use the edited recurring amount", () => {
  const incomes = [
    {
      id: "salary",
      name: "Salary",
      amount: 3600,
      isRecurrent: true,
      recurrency: "MONTHLY_14" as const,
    },
  ];

  assert.equal(calculateAverageMonthlyIncome(incomes), 4200);
  assert.equal(toBudgetCreateIncomes(incomes)[0].amount, 4200);
  assert.deepEqual(toBudgetCreateIncomes(incomes), [
    {
      id: "salary",
      name: "Salary",
      amount: 4200,
      isRecurrent: true,
      recurrency: "MONTHLY_14",
    },
  ]);
});

test("stored monthly-equivalent budget incomes annualize without applying recurrency again", () => {
  assert.equal(
    calculateStoredMonthlyEquivalentAnnualIncome([
      { name: "Salary", amount: 4200, recurrency: "MONTHLY_14" },
      { name: "Bonus", amount: 100, recurrency: "ANNUALLY" },
    ]),
    51600,
  );
});

test("income edits replace by id without mutating the existing array", () => {
  const original = [
    {
      id: "salary",
      name: "Salary",
      amount: 2000,
      isRecurrent: true,
      recurrency: "MONTHLY_14" as const,
    },
  ];

  const updated = replaceIncomeById(original, {
    ...original[0],
    amount: 3600,
  });

  assert.notEqual(updated, original);
  assert.equal(original[0].amount, 2000);
  assert.equal(updated[0].amount, 3600);
});

test("parent categories without a positive budget are created without adding zero budget rows", () => {
  assert.equal(
    shouldAddCreatedCategoryToBudget({
      parentCategoryKey: null,
      budgetAmount: 0,
    }),
    false,
  );
  assert.equal(
    shouldAddCreatedCategoryToBudget({
      parentCategoryKey: "123",
      budgetAmount: 50,
    }),
    true,
  );
});

test("starter profiles return conservative category suggestions", () => {
  const suggestions = getBudgetStarterCategorySuggestions({
    profileKey: "family",
    averageMonthlyIncome: 4000,
    householdSize: 4,
    dependentCount: 2,
  });

  assert.ok(suggestions.length >= 6);
  assert.ok(suggestions.every((suggestion) => suggestion.monthlyAmount >= 0));
  assert.ok(
    suggestions.some((suggestion) => suggestion.key === "childcare-education"),
  );
  assert.ok(
    suggestions.some((suggestion) => suggestion.key === "savings-buffer"),
  );
});

test("starter profile suggested amounts scale with income", () => {
  const lowerIncomeSuggestions = getBudgetStarterCategorySuggestions({
    profileKey: "single",
    averageMonthlyIncome: 3000,
  });
  const higherIncomeSuggestions = getBudgetStarterCategorySuggestions({
    profileKey: "single",
    averageMonthlyIncome: 6000,
  });

  const lowerHousing = lowerIncomeSuggestions.find(
    (suggestion) => suggestion.key === "housing",
  );
  const higherHousing = higherIncomeSuggestions.find(
    (suggestion) => suggestion.key === "housing",
  );

  assert.equal(lowerHousing?.monthlyAmount, 1050);
  assert.equal(higherHousing?.monthlyAmount, 2100);
});

test("starter profile totals do not exceed income", () => {
  for (const profileKey of [
    "single",
    "couple",
    "family",
    "freelancer",
  ] as const) {
    const suggestions = getBudgetStarterCategorySuggestions({
      profileKey,
      averageMonthlyIncome: 3200,
      householdSize: profileKey === "single" ? 1 : 3,
      dependentCount: profileKey === "family" ? 1 : 0,
    });

    assert.ok(calculateStarterProfileMonthlyTotal(suggestions) <= 3200);
  }
});

test("custom starter profile preserves manual category behavior", () => {
  assert.deepEqual(
    getBudgetStarterCategorySuggestions({
      profileKey: "custom",
      averageMonthlyIncome: 5000,
      householdSize: 2,
      dependentCount: 1,
    }),
    [],
  );
});

test("starter suggestions only update safely matched system categories", () => {
  const rows = [
    {
      key: 1,
      name: "HOUSING",
      budgeted: 1500,
      subRows: [
        {
          key: 2,
          name: "RENT_MORTGAGE",
          budgeted: 1000,
        },
        {
          key: 3,
          name: "UTILITIES",
          budgeted: 500,
        },
      ],
    },
    {
      key: 4,
      name: "FOOD",
      budgeted: 300,
      subRows: [
        {
          key: 5,
          name: "GROCERIES",
          budgeted: 200,
        },
        {
          key: 6,
          name: "CAFE_RESTAURANTS_BARS",
          budgeted: 100,
        },
      ],
    },
  ];

  const result = applyBudgetStarterCategorySuggestionsToBudgetRows(rows, [
    {
      key: "housing",
      labelKey: "budget-starter-category-housing",
      group: "essentials",
      monthlyAmount: 900,
    },
    {
      key: "groceries",
      labelKey: "budget-starter-category-groceries",
      group: "essentials",
      monthlyAmount: 120,
    },
  ]);

  assert.equal(result.matchedCount, 2);
  assert.deepEqual(result.matchedRows, [
    { categoryKey: 2, amount: 1000 },
    { categoryKey: 5, amount: 200 },
  ]);
  assert.equal(result.changedCount, 2);
  assert.deepEqual(result.changedRows, [
    { categoryKey: 2, amount: 900 },
    { categoryKey: 5, amount: 120 },
  ]);
  assert.notEqual(result.rows, rows);
  assert.equal(rows[0].budgeted, 1500);
  assert.equal(result.rows[0].budgeted, 1400);
  assert.equal(result.rows[0].subRows[0].budgeted, 900);
  assert.equal(result.rows[0].subRows[1].budgeted, 500);
  assert.equal(result.rows[1].budgeted, 220);
  assert.equal(result.rows[1].subRows[0].budgeted, 120);
  assert.equal(result.rows[1].subRows[1].budgeted, 100);
});

test("starter suggestions do not update read-only parents or unmatched categories", () => {
  const rows = [
    {
      key: 1,
      name: "HOUSING",
      budgeted: 1200,
      subRows: [
        {
          key: 2,
          name: "MAINTENANCE",
          budgeted: 200,
        },
      ],
    },
  ];

  const result = applyBudgetStarterCategorySuggestionsToBudgetRows(rows, [
    {
      key: "housing",
      labelKey: "budget-starter-category-housing",
      group: "essentials",
      monthlyAmount: 900,
    },
  ]);

  assert.equal(result.matchedCount, 0);
  assert.equal(result.changedCount, 0);
  assert.deepEqual(result.rows, rows);
  assert.equal(result.rows[0].budgeted, 1200);
  assert.equal(result.rows[0].subRows[0].budgeted, 200);
});

test("starter suggestions report already-applied editable matches without changing rows", () => {
  const rows = [
    {
      key: 1,
      name: "FOOD",
      budgeted: 300,
      subRows: [
        {
          key: 2,
          name: "GROCERIES",
          budgeted: 120,
        },
      ],
    },
  ];

  const result = applyBudgetStarterCategorySuggestionsToBudgetRows(rows, [
    {
      key: "groceries",
      labelKey: "budget-starter-category-groceries",
      group: "essentials",
      monthlyAmount: 120,
    },
  ]);

  assert.equal(result.matchedCount, 1);
  assert.deepEqual(result.matchedRows, [{ categoryKey: 2, amount: 120 }]);
  assert.equal(result.changedCount, 0);
  assert.deepEqual(result.changedRows, []);
  assert.deepEqual(result.rows, rows);
});

test("starter suggestions skip duplicate unsafe matches", () => {
  const rows = [
    {
      key: 1,
      name: "FOOD",
      budgeted: 400,
      subRows: [
        {
          key: 2,
          name: "GROCERIES",
          budgeted: 200,
        },
      ],
    },
    {
      key: 3,
      name: "FOOD-2",
      budgeted: 200,
      subRows: [
        {
          key: 4,
          name: "GROCERIES",
          budgeted: 100,
        },
      ],
    },
  ];

  const result = applyBudgetStarterCategorySuggestionsToBudgetRows(rows, [
    {
      key: "groceries",
      labelKey: "budget-starter-category-groceries",
      group: "essentials",
      monthlyAmount: 120,
    },
  ]);

  assert.equal(result.changedCount, 0);
  assert.deepEqual(result.rows, rows);
});

test("custom starter profile leaves manual budget rows unchanged", () => {
  const rows = [
    {
      key: 1,
      name: "custom savings",
      budgeted: 80,
      subRows: [],
    },
  ];

  assert.deepEqual(
    applyBudgetStarterCategorySuggestionsToBudgetRows(rows, []),
    {
      rows,
      matchedCount: 0,
      matchedRows: [],
      changedCount: 0,
      changedRows: [],
    },
  );
});

test("starter profile application updates editable rows and preserves metadata", () => {
  const rows = [
    {
      key: 1,
      name: "HOUSING",
      budgeted: 1500,
      icon: "home",
      textColor: "fixture-text-primary",
      bgColor: "fixture-bg-primary",
      isSystemCategory: true,
      subRows: [
        {
          key: 2,
          name: "RENT_MORTGAGE",
          budgeted: 1000,
          icon: "house",
          textColor: "fixture-text-nested",
          bgColor: "fixture-bg-nested",
          isSystemCategory: true,
        },
      ],
    },
    {
      key: 3,
      name: "GROCERIES",
      budgeted: 200,
      icon: "cart",
      textColor: "fixture-text-primary",
      bgColor: "fixture-bg-primary",
      isSystemCategory: true,
      subRows: [
        {
          key: 4,
          name: "GROCERIES",
          budgeted: 200,
          icon: "cart",
          textColor: "fixture-text-primary",
          bgColor: "fixture-bg-primary",
          isSystemCategory: true,
        },
      ],
    },
  ];

  const result = applyBudgetStarterProfileToBudgetRows({
    rows,
    profileKey: "single",
    averageMonthlyIncome: 4000,
  });

  assert.ok(result.suggestions.length > 0);
  assert.equal(result.matchedCount > 0, true);
  assert.equal(result.changedCount > 0, true);
  assert.notEqual(result.rows, rows);
  assert.equal(result.rows[0].icon, "home");
  assert.equal(result.rows[0].textColor, "fixture-text-primary");
  assert.equal(result.rows[0].bgColor, "fixture-bg-primary");
  assert.equal(result.rows[0].subRows?.[0].icon, "house");
  assert.equal(result.rows[0].subRows?.[0].budgeted, 1400);
  assert.equal(result.rows[1].subRows?.[0].budgeted, 560);
});
