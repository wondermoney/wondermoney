import assert from "node:assert/strict";

import { test } from "vitest";

import {
  calculateParentBudgetedFromSubRows,
  calculatePlannedAndSpentValue,
  convertBudgetTemplatesIntoRows,
  getBudgetRowMonthlyBudgetedTotal,
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
