import assert from "node:assert/strict";

import { test } from "vitest";

import { computeSankeyLayout, resolveNodeColor } from "./sankey-layout";

const sampleData = {
  nodes: [
    { id: "salary", label: "Salary", kind: "income" as const, color: "#4ade80" },
    { id: "other", label: "Other income", kind: "income" as const },
    { id: "rent", label: "Rent", kind: "expense" as const },
    { id: "food", label: "Food", kind: "expense" as const },
    { id: "main", label: "Main account", kind: "account" as const },
  ],
  links: [
    { source: "salary", target: "rent", value: 1200 },
    { source: "salary", target: "food", value: 400 },
    { source: "salary", target: "main", value: 2400 },
    { source: "other", target: "main", value: 300 },
  ],
};

test("resolveNodeColor returns provided color when present", () => {
  assert.equal(resolveNodeColor({ id: "x", label: "X", kind: "income", color: "#fff" }), "#fff");
});

test("resolveNodeColor falls back to chart token for kind", () => {
  assert.equal(resolveNodeColor({ id: "x", label: "X", kind: "expense" }), "var(--color-chart-2)");
  assert.equal(resolveNodeColor({ id: "x", label: "X", kind: "account" }), "var(--color-chart-3)");
});

test("computeSankeyLayout returns positioned nodes and links", () => {
  const layout = computeSankeyLayout(sampleData, { width: 800, height: 360 });

  assert.equal(layout.nodes.length, 5);
  assert.equal(layout.links.length, 4);
  assert.ok(layout.totalValue > 0);
  assert.equal(layout.columns, 3);

  for (const node of layout.nodes) {
    assert.ok(node.x0 >= 0);
    assert.ok(node.x1 <= 800);
    assert.ok(node.y0 >= -0.001);
    assert.ok(node.y1 <= 360);
  }

  for (const link of layout.links) {
    assert.ok(link.path.length > 0);
    assert.ok(link.width >= 0);
  }
});

test("computeSankeyLayout positions income, expense, account in left-to-right order", () => {
  const layout = computeSankeyLayout(sampleData, { width: 800, height: 360 });

  const incomeX = layout.nodes.filter((n) => n.kind === "income").map((n) => n.x0);
  const expenseX = layout.nodes.filter((n) => n.kind === "expense").map((n) => n.x0);
  const accountX = layout.nodes.filter((n) => n.kind === "account").map((n) => n.x0);

  assert.ok(Math.max(...incomeX) < Math.min(...expenseX));
  assert.ok(Math.max(...expenseX) < Math.min(...accountX));
});

test("computeSankeyLayout falls back to two columns when no account nodes", () => {
  const twoColumnData = {
    nodes: [
      { id: "salary", label: "Salary", kind: "income" as const },
      { id: "rent", label: "Rent", kind: "expense" as const },
    ],
    links: [{ source: "salary", target: "rent", value: 1000 }],
  };

  const layout = computeSankeyLayout(twoColumnData, { width: 800, height: 360 });
  assert.equal(layout.columns, 2);
});

test("computeSankeyLayout preserves node colors", () => {
  const layout = computeSankeyLayout(sampleData, { width: 800, height: 360 });
  const salary = layout.nodes.find((n) => n.id === "salary");
  assert.equal(salary?.color, "#4ade80");
});
