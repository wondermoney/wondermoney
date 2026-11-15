import { describe, expect, it } from "vitest";
import {
  BUDGET_CATEGORIES,
  BUDGET_MAX_AMOUNT,
  HOUSEHOLD_BUDGET_WORKED_EXAMPLE,
  computeHouseholdBudget,
  type BudgetCategory,
} from "./householdBudget";

function categoryTotal(result: ReturnType<typeof computeHouseholdBudget>, category: BudgetCategory) {
  return result.categories.find((entry) => entry.category === category);
}

describe("computeHouseholdBudget", () => {
  it("adds income and expenses, and works out the surplus and savings rate", () => {
    const result = computeHouseholdBudget({
      incomes: [
        { id: "salary", amount: 2000 },
        { id: "other", amount: 500 },
      ],
      expenses: [
        { id: "rent", category: "housing", amount: 800 },
        { id: "groceries", category: "food", amount: 400 },
        { id: "eatingOut", category: "food", amount: 100 },
      ],
    });

    expect(result.totalIncome).toBe(2500);
    expect(result.totalExpenses).toBe(1300);
    expect(result.balance).toBe(1200);
    expect(result.status).toBe("surplus");
    expect(result.savingsRate).toBe(48);
    expect(result.expensesShareOfIncome).toBe(52);
    expect(categoryTotal(result, "housing")).toEqual({ category: "housing", total: 800, shareOfIncome: 32 });
    expect(categoryTotal(result, "food")).toEqual({ category: "food", total: 500, shareOfIncome: 20 });
  });

  it("lists every category once, in the fixed order, even when empty", () => {
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: 1000 }],
      expenses: [{ id: "x", category: "other", amount: 10 }],
    });

    expect(result.categories.map((entry) => entry.category)).toEqual([...BUDGET_CATEGORIES]);
    expect(categoryTotal(result, "health")).toEqual({ category: "health", total: 0, shareOfIncome: 0 });
  });

  it("reports a deficit and a negative savings rate when expenses exceed income", () => {
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: 1500 }],
      expenses: [
        { id: "rent", category: "housing", amount: 1100 },
        { id: "loan", category: "debtPayments", amount: 600 },
      ],
    });

    expect(result.status).toBe("deficit");
    expect(result.balance).toBe(-200);
    expect(result.savingsRate).toBe(-13.3);
    expect(categoryTotal(result, "housing")?.shareOfIncome).toBe(73.3);
  });

  it("reads as balanced when expenses use up the income exactly", () => {
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: 1000 }],
      expenses: [{ id: "rent", category: "housing", amount: 1000 }],
    });

    expect(result.status).toBe("balanced");
    expect(result.balance).toBe(0);
    expect(result.savingsRate).toBe(0);
  });

  it("gives no savings rate or shares without income, and counts all spending as a deficit", () => {
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: 0 }],
      expenses: [{ id: "rent", category: "housing", amount: 700 }],
    });

    expect(result.status).toBe("noIncome");
    expect(result.totalIncome).toBe(0);
    expect(result.balance).toBe(-700);
    expect(result.savingsRate).toBeNull();
    expect(result.expensesShareOfIncome).toBeNull();
    expect(categoryTotal(result, "housing")).toEqual({ category: "housing", total: 700, shareOfIncome: null });
  });

  it("returns an empty budget when nothing is entered", () => {
    const result = computeHouseholdBudget({ incomes: [], expenses: [] });

    expect(result.status).toBe("empty");
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.balance).toBe(0);
    expect(result.savingsRate).toBeNull();
  });

  it("keeps the whole income as surplus when there are no expenses", () => {
    const result = computeHouseholdBudget({ incomes: [{ id: "salary", amount: 1800 }], expenses: [] });

    expect(result.status).toBe("surplus");
    expect(result.totalExpenses).toBe(0);
    expect(result.balance).toBe(1800);
    expect(result.savingsRate).toBe(100);
  });

  it("ignores empty, negative and non-finite amounts", () => {
    const result = computeHouseholdBudget({
      incomes: [
        { id: "a", amount: 1000 },
        { id: "b", amount: Number.NaN },
        { id: "c", amount: -300 },
      ],
      expenses: [
        { id: "d", category: "food", amount: Number.POSITIVE_INFINITY },
        { id: "e", category: "food", amount: -20 },
        { id: "f", category: "food", amount: 250 },
      ],
    });

    expect(result.totalIncome).toBe(1000);
    expect(result.totalExpenses).toBe(250);
  });

  it("rounds totals to the cent so many decimal rows add up cleanly", () => {
    const expenses = Array.from({ length: 10 }, (_, index) => ({
      id: `row-${index}`,
      category: "other" as const,
      amount: 0.1,
    }));
    const result = computeHouseholdBudget({ incomes: [{ id: "salary", amount: 0.3 }], expenses });

    expect(result.totalExpenses).toBe(1);
    expect(result.balance).toBe(-0.7);
  });

  it("handles many rows", () => {
    const expenses = BUDGET_CATEGORIES.flatMap((category) =>
      Array.from({ length: 25 }, (_, index) => ({ id: `${category}-${index}`, category, amount: 4 })),
    );
    const result = computeHouseholdBudget({ incomes: [{ id: "salary", amount: 1000 }], expenses });

    expect(result.totalExpenses).toBe(800);
    expect(result.categories.every((entry) => entry.total === 100 && entry.shareOfIncome === 10)).toBe(true);
    expect(result.savingsRate).toBe(20);
  });

  it("caps huge amounts so totals and shares stay finite", () => {
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: Number.MAX_VALUE }],
      expenses: [
        { id: "a", category: "housing", amount: Number.MAX_VALUE },
        { id: "b", category: "housing", amount: 1e300 },
      ],
    });

    expect(result.totalIncome).toBe(BUDGET_MAX_AMOUNT);
    expect(result.totalExpenses).toBe(2 * BUDGET_MAX_AMOUNT);
    expect(Number.isFinite(result.savingsRate)).toBe(true);
    expect(result.savingsRate).toBe(-100);
    expect(categoryTotal(result, "housing")?.shareOfIncome).toBe(200);
  });

  it("rounds category shares and the surplus together so they add up to 100%", () => {
    // Each part is a third of income: rounded on its own, each would be 33.3%.
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: 300 }],
      expenses: [
        { id: "rent", category: "housing", amount: 100 },
        { id: "groceries", category: "food", amount: 100 },
      ],
    });

    expect(categoryTotal(result, "housing")?.shareOfIncome).toBe(33.4);
    expect(categoryTotal(result, "food")?.shareOfIncome).toBe(33.3);
    expect(result.savingsRate).toBe(33.3);
    expect(result.expensesShareOfIncome).toBe(66.7);
  });

  it("makes category shares add up to the expenses share when there is a deficit", () => {
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: 300 }],
      expenses: [
        { id: "rent", category: "housing", amount: 200 },
        { id: "groceries", category: "food", amount: 200 },
      ],
    });

    expect(categoryTotal(result, "housing")?.shareOfIncome).toBe(66.7);
    expect(categoryTotal(result, "food")?.shareOfIncome).toBe(66.6);
    expect(result.expensesShareOfIncome).toBe(133.3);
    expect(result.savingsRate).toBe(-33.3);
  });

  it("keeps the shown shares consistent for any budget", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const tenths = (value: number | null) => Math.round((value ?? 0) * 10);

    for (let run = 0; run < 500; run++) {
      const expenses = BUDGET_CATEGORIES.map((category, index) => ({
        id: String(index),
        category,
        amount: Math.round(next() * 100000) / 100,
      }));
      const income = Math.round(next() * 600000) / 100 + 0.01;
      const result = computeHouseholdBudget({ incomes: [{ id: "salary", amount: income }], expenses });
      const categoryTenths = result.categories.reduce((sum, entry) => sum + tenths(entry.shareOfIncome), 0);

      expect(categoryTenths).toBe(tenths(result.expensesShareOfIncome));
      expect(categoryTenths + tenths(result.savingsRate)).toBe(1000);
      // Largest remainder keeps every shown share within a tenth of its exact value.
      const exact = (result.totalExpenses / result.totalIncome) * 1000;
      expect(Math.abs(tenths(result.expensesShareOfIncome) - exact)).toBeLessThan(1);
      for (const entry of result.categories) {
        expect(Math.abs(tenths(entry.shareOfIncome) - (entry.total / result.totalIncome) * 1000)).toBeLessThan(1);
      }
    }
  });

  it("rounds each row to the cent so category totals and the overall total agree", () => {
    const result = computeHouseholdBudget({
      incomes: [{ id: "salary", amount: 1000.004 }],
      expenses: [
        { id: "a", category: "housing", amount: 0.005 },
        { id: "b", category: "food", amount: 0.005 },
        { id: "c", category: "other", amount: 0.005 },
      ],
    });

    expect(categoryTotal(result, "housing")?.total).toBe(0.01);
    expect(categoryTotal(result, "food")?.total).toBe(0.01);
    expect(categoryTotal(result, "other")?.total).toBe(0.01);
    expect(result.totalExpenses).toBe(0.03);
    expect(result.totalIncome).toBe(1000);
  });

  it("works out the page's worked example", () => {
    const result = computeHouseholdBudget(HOUSEHOLD_BUDGET_WORKED_EXAMPLE);

    expect(result.totalIncome).toBe(2850);
    expect(result.totalExpenses).toBe(2210);
    expect(result.balance).toBe(640);
    expect(result.savingsRate).toBe(22.5);
    expect(categoryTotal(result, "housing")?.shareOfIncome).toBe(29.8);
    expect(categoryTotal(result, "utilities")?.total).toBe(160);
  });
});
