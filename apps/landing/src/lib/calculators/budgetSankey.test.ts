import { describe, expect, it } from "vitest";
import { SANKEY_MAX_INCOME_NODES, layoutBudgetSankey, spreadLabels } from "./budgetSankey";
import {
  HOUSEHOLD_BUDGET_WORKED_EXAMPLE,
  computeHouseholdBudget,
  type HouseholdBudgetParams,
} from "./householdBudget";

function layout(params: HouseholdBudgetParams, width = 640) {
  return layoutBudgetSankey(params.incomes, computeHouseholdBudget(params), width);
}

function sumOf(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

describe("layoutBudgetSankey", () => {
  it("draws income sources into the month's total and out to categories and the surplus", () => {
    const diagram = layout(HOUSEHOLD_BUDGET_WORKED_EXAMPLE);
    if (!diagram) throw new Error("expected a diagram");

    const ids = diagram.nodes.map((node) => node.id);
    expect(ids).toEqual([
      "income:salary",
      "income:other",
      "total",
      "category:housing",
      "category:food",
      "category:transport",
      "category:utilities",
      "category:health",
      "category:debtPayments",
      "category:leisure",
      "category:other",
      "surplus",
    ]);
    expect(diagram.nodes.find((node) => node.id === "surplus")?.value).toBe(640);
    expect(diagram.nodes.find((node) => node.id === "total")?.value).toBe(2850);

    const inflow = diagram.links.filter((link) => link.targetId === "total").map((link) => link.value);
    const outflow = diagram.links.filter((link) => link.sourceId === "total").map((link) => link.value);
    expect(sumOf(inflow)).toBeCloseTo(2850, 2);
    expect(sumOf(outflow)).toBeCloseTo(2850, 2);
  });

  it("adds a shortfall source instead of a surplus when expenses exceed income", () => {
    const diagram = layout({
      incomes: [{ id: "salary", amount: 1000 }],
      expenses: [{ id: "rent", category: "housing", amount: 1300 }],
    });
    if (!diagram) throw new Error("expected a diagram");

    expect(diagram.nodes.map((node) => node.id)).toEqual([
      "income:salary",
      "shortfall",
      "total",
      "category:housing",
    ]);
    expect(diagram.nodes.find((node) => node.id === "shortfall")?.value).toBe(300);
    expect(diagram.nodes.find((node) => node.id === "total")?.value).toBe(1300);
  });

  it("funds everything from the shortfall when there is no income", () => {
    const diagram = layout({
      incomes: [{ id: "salary", amount: 0 }],
      expenses: [{ id: "rent", category: "housing", amount: 500 }],
    });

    expect(diagram?.nodes.map((node) => node.id)).toEqual(["shortfall", "total", "category:housing"]);
  });

  it("shows only the surplus when there are no expenses", () => {
    const diagram = layout({ incomes: [{ id: "salary", amount: 1200 }], expenses: [] });

    expect(diagram?.nodes.map((node) => node.id)).toEqual(["income:salary", "total", "surplus"]);
  });

  it("draws nothing for an empty budget", () => {
    expect(layout({ incomes: [{ id: "salary", amount: 0 }], expenses: [] })).toBeNull();
  });

  it("folds the smallest income rows into one node when there are many", () => {
    const incomes = Array.from({ length: 12 }, (_, index) => ({ id: `job-${index}`, amount: (index + 1) * 100 }));
    const diagram = layout({ incomes, expenses: [] });
    if (!diagram) throw new Error("expected a diagram");

    const left = diagram.nodes.filter((node) => node.column === 0);
    expect(left).toHaveLength(SANKEY_MAX_INCOME_NODES);
    const others = left.find((node) => node.kind === "otherIncome");
    expect(others?.count).toBe(12 - (SANKEY_MAX_INCOME_NODES - 1));
    expect(sumOf(left.map((node) => node.value))).toBe(sumOf(incomes.map((row) => row.amount)));
    // The largest rows keep their own node, in the order they were entered.
    expect(left.slice(0, -1).map((node) => node.refId)).toEqual(["job-7", "job-8", "job-9", "job-10", "job-11"]);
  });

  it("keeps every node and label inside the drawing, whatever the width", () => {
    for (const width of [280, 640, 1100]) {
      const diagram = layout(HOUSEHOLD_BUDGET_WORKED_EXAMPLE, width);
      if (!diagram) throw new Error("expected a diagram");

      for (const node of diagram.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.x + node.width).toBeLessThanOrEqual(width);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.y + node.height).toBeLessThanOrEqual(diagram.height + 0.001);
        expect(node.labelY).toBeGreaterThanOrEqual(0);
        expect(node.labelY).toBeLessThanOrEqual(diagram.height);
      }
    }
  });

  it("keeps a visible band for a tiny amount next to a huge one", () => {
    const diagram = layout({
      incomes: [{ id: "salary", amount: 1e12 }],
      expenses: [{ id: "coffee", category: "food", amount: 3 }],
    });
    if (!diagram) throw new Error("expected a diagram");

    const coffee = diagram.links.find((link) => link.targetId === "category:food");
    expect(coffee?.thickness).toBeGreaterThanOrEqual(1);
    for (const link of diagram.links) expect(link.path).not.toMatch(/NaN|Infinity/);
  });
});

describe("spreadLabels", () => {
  it("leaves labels that are far enough apart alone", () => {
    expect(spreadLabels([10, 40, 80], 18, 0, 100)).toEqual([10, 40, 80]);
  });

  it("pushes crowded labels apart and back inside the range", () => {
    const placed = spreadLabels([90, 91, 92], 18, 0, 100);

    expect(placed).toEqual([64, 82, 100]);
  });
});
