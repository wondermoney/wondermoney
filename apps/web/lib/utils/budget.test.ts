import assert from "node:assert/strict";

import { test } from "vitest";

import {
  calculateParentBudgetedFromSubRows,
  calculatePlannedAndSpentValue,
  convertBudgetTemplatesIntoRows,
  getBudgetRowMonthlyBudgetedTotal,
  getBudgetRowProgress,
  getBudgetRowRemaining,
  getMonthlyAvailableValue,
} from "./budget";

test("budget row totals include top-level rows without children", () => {
  const rows = [
    {
      key: 1,
      name: "Parent with children",
      budgeted: 100,
      spent: 25,
      icon: "home",
      textColor: "#000000",
      bgColor: "#ffffff",
      isSystemCategory: true,
      subRows: [
        {
          key: 2,
          name: "Child",
          budgeted: 100,
          spent: 25,
          icon: "home",
          textColor: "#000000",
          bgColor: "#ffffff",
          isSystemCategory: true,
          recurrency: 12,
        },
      ],
    },
    {
      key: 3,
      name: "Standalone",
      budgeted: 50,
      spent: 10,
      icon: "tag",
      textColor: "#000000",
      bgColor: "#ffffff",
      isSystemCategory: false,
      subRows: [],
    },
  ];

  assert.equal(getBudgetRowMonthlyBudgetedTotal(rows), 150);

  const totals = calculatePlannedAndSpentValue(rows);
  assert.equal(totals.totalPlanned, 150);
  assert.equal(totals.totalSpent, 35);
});

test("parent budget recalculation normalizes child recurrency to monthly equivalent", () => {
  assert.equal(
    calculateParentBudgetedFromSubRows([
      {
        key: 1,
        name: "Annual child",
        budgeted: 1200,
        spent: 0,
        icon: "tag",
        textColor: "#000000",
        bgColor: "#ffffff",
        isSystemCategory: false,
        recurrency: 1,
      },
      {
        key: 2,
        name: "Monthly child",
        budgeted: 100,
        spent: 0,
        icon: "tag",
        textColor: "#000000",
        bgColor: "#ffffff",
        isSystemCategory: false,
        recurrency: 12,
      },
    ]),
    200,
  );
});

test("budget template conversion preserves standalone row recurrency", () => {
  const rows = convertBudgetTemplatesIntoRows([
    {
      child_category_name: null,
      parent_category_name: "Annual standalone",
      category_amount: 0,
      category_recurrency: "ANNUALLY",
      category_budgeted_amount: 1200,
      child_category_icon: "tag",
      child_category_text_color: "#000000",
      child_category_bg_color: "#ffffff",
      category_is_system_category: false,
      category_icon: "tag",
      category_text_color: "#000000",
      category_bg_color: "#ffffff",
      category_key: 99,
    },
  ]);

  assert.equal(getBudgetRowMonthlyBudgetedTotal(rows), 100);
});

test("planned and spent totals avoid NaN percentages when nothing is budgeted", () => {
  const totals = calculatePlannedAndSpentValue([
    {
      key: 1,
      name: "Empty",
      budgeted: 0,
      spent: 0,
      icon: "tag",
      textColor: "#000000",
      bgColor: "#ffffff",
      isSystemCategory: false,
      subRows: [],
    },
  ]);

  assert.equal(totals.totalPlanned, 0);
  assert.equal(totals.totalSpent, 0);
  assert.equal(totals.totalPercentage, 0);
});

test("budget row monthly total normalizes standalone mixed recurrencies", () => {
  assert.equal(
    getBudgetRowMonthlyBudgetedTotal([
      {
        key: 1,
        name: "Annual",
        budgeted: 1200,
        spent: 0,
        recurrency: 1,
        subRows: [],
      },
      {
        key: 2,
        name: "Quarterly",
        budgeted: 300,
        spent: 0,
        recurrency: 4,
        subRows: [],
      },
    ]),
    200,
  );
});

test("overview planned total matches detail child-category total for QA budget values", () => {
  const rows = [
    {
      key: 1,
      name: "Living costs",
      budgeted: 1900,
      spent: 0,
      subRows: [
        {
          key: 2,
          name: "Housing",
          budgeted: 1000.11,
          spent: 0,
          recurrency: 12,
        },
        {
          key: 3,
          name: "Food",
          budgeted: 903.2,
          spent: 0,
          recurrency: 12,
        },
      ],
    },
  ];

  const expectedDetailPlannedTotal = 1903.31;
  const monthlyIncome = 3600;
  const overviewTotals = calculatePlannedAndSpentValue(rows as any);

  assert.equal(
    Math.round(getBudgetRowMonthlyBudgetedTotal(rows) * 100) / 100,
    expectedDetailPlannedTotal,
  );
  assert.equal(
    Math.round(overviewTotals.totalPlanned * 100) / 100,
    expectedDetailPlannedTotal,
  );
  assert.equal(
    Math.round((monthlyIncome - overviewTotals.totalPlanned) * 100) / 100,
    1696.69,
  );
});

test("a parent row plans what its children plan per month, yearly items spread over twelve", () => {
  const child = (
    key: number,
    name: string,
    amount: number,
    recurrency: string,
  ) => ({
    child_category_name: name,
    parent_category_name: "TRANSPORTATION",
    category_amount: 0,
    category_budgeted_amount: amount,
    category_recurrency: recurrency,
    category_icon: "car",
    category_text_color: "#000000",
    category_bg_color: "#ffffff",
    category_is_system_category: true,
    category_key: key,
  });
  const rows = convertBudgetTemplatesIntoRows([
    // The API's parent amount is the raw sum of its children (400 + 600 + 80 + 120).
    {
      ...child(1, "", 1200, ""),
      child_category_name: null,
      category_recurrency: null,
    },
    child(2, "VEHICLE_MAINTENANCE", 400, "ANNUALLY"),
    child(3, "VEHICLE_INSURANCE", 600, "ANNUALLY"),
    child(4, "PUBLIC_TRANSPORT", 80, "MONTHLY"),
    child(5, "FUEL", 120, "MONTHLY"),
  ] as Parameters<typeof convertBudgetTemplatesIntoRows>[0]);

  const parent = rows[0]!;
  assert.equal(Math.round(parent.budgeted * 100) / 100, 283.33);
  assert.equal(
    Math.round(getBudgetRowMonthlyBudgetedTotal(rows) * 100) / 100,
    Math.round(parent.budgeted * 100) / 100,
  );
});

/* ---------- rollover ---------- */

const apiCategory = (
  overrides: Partial<Parameters<typeof convertBudgetTemplatesIntoRows>[0][number]>,
) => ({
  child_category_name: null,
  parent_category_name: "FOOD",
  category_amount: 0,
  category_recurrency: null,
  category_budgeted_amount: 0,
  child_category_icon: "tag",
  child_category_text_color: "#000000",
  child_category_bg_color: "#ffffff",
  category_is_system_category: true,
  category_icon: "tag",
  category_text_color: "#000000",
  category_bg_color: "#ffffff",
  category_key: 1,
  ...overrides,
});

test("a row with a carry has the plan plus the carry to spend, and remaining and progress measure against that", () => {
  const surplus = { budgeted: 100, spent: 120, recurrency: 12, rolledOver: 40 };
  assert.equal(getMonthlyAvailableValue(surplus), 140);
  assert.equal(getBudgetRowRemaining(surplus), 20);
  assert.equal(getBudgetRowProgress(surplus), 120 / 140);

  // An overspend carried in leaves less than the plan.
  const overspend = { budgeted: 100, spent: 80, recurrency: 12, rolledOver: -25 };
  assert.equal(getMonthlyAvailableValue(overspend), 75);
  assert.equal(getBudgetRowRemaining(overspend), -5);
});

test("without rollover, available is the plan as the Planned column shows it", () => {
  const yearly = { budgeted: 1200, spent: 50, recurrency: 1 };
  assert.equal(getMonthlyAvailableValue(yearly), 100);
  assert.equal(getBudgetRowRemaining(yearly), 50);
  assert.equal(getBudgetRowProgress({ budgeted: 0, spent: 10 }), 0);
});

test("the API's rollover fields reach the rows, and a parent keeps its subcategories' summed carry", () => {
  const rows = convertBudgetTemplatesIntoRows([
    apiCategory({
      category_key: 1,
      category_budgeted_amount: 300,
      category_amount: 0,
      category_rolled_over: 15,
      category_available: 315,
      category_rollover_enabled: true,
      category_rollover_incomplete: true,
    }),
    apiCategory({
      category_key: 2,
      child_category_name: "GROCERIES",
      category_recurrency: "MONTHLY",
      category_budgeted_amount: 200,
      category_rolled_over: 40,
      category_available: 240,
      category_rollover_enabled: true,
      category_rollover_incomplete: true,
    }),
    apiCategory({
      category_key: 3,
      child_category_name: "CAFE_RESTAURANTS_BARS",
      category_recurrency: "MONTHLY",
      category_budgeted_amount: 100,
      category_rolled_over: -25,
      category_available: 75,
      category_rollover_enabled: true,
    }),
  ]);

  const [parent] = rows;
  assert.equal(parent!.rolledOver, 15);
  assert.equal(parent!.rolloverEnabled, true);
  assert.equal(parent!.rolloverIncomplete, true);
  assert.deepEqual(
    parent!.subRows.map((child) => [child.rolledOver, getMonthlyAvailableValue(child)]),
    [
      [40, 240],
      [-25, 75],
    ],
  );
  assert.equal(getMonthlyAvailableValue(parent!), 315);
});

test("rows from an endpoint without rollover fields carry nothing", () => {
  const [row] = convertBudgetTemplatesIntoRows([
    apiCategory({ category_budgeted_amount: 50 }),
  ]);
  assert.equal(row!.rolledOver, 0);
  assert.equal(row!.rolloverEnabled, false);
  assert.equal(row!.rolloverIncomplete, false);
});

test("month totals keep the plan as planned and measure remaining against plan plus carry", () => {
  const totals = calculatePlannedAndSpentValue([
    {
      key: 1,
      name: "FOOD",
      budgeted: 300,
      spent: 330,
      rolledOver: 15,
      subRows: [
        { key: 2, name: "GROCERIES", budgeted: 200, spent: 230, recurrency: 12, rolledOver: 40 },
        { key: 3, name: "CAFES", budgeted: 100, spent: 100, recurrency: 12, rolledOver: -25 },
      ],
    },
  ]);

  assert.equal(totals.totalPlanned, 300);
  assert.equal(totals.totalAvailable, 315);
  assert.equal(totals.totalSpent, 330);
  assert.equal(totals.totalPercentage, ((315 - 330) / 315) * 100);
});
