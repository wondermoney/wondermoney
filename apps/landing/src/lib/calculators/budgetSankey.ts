/**
 * Layout for the household budget's flow diagram: income sources on the left,
 * one node for the month's money in the middle, and the expense categories plus
 * the surplus on the right. When expenses are above income, a shortfall node on
 * the left makes up the difference so every band still balances.
 *
 * Pure geometry in SVG user units, so it is testable and needs no chart library.
 */
import {
  toBudgetAmount,
  type BudgetCategory,
  type HouseholdBudgetResult,
  type IncomeRow,
} from "./householdBudget";

export type SankeyNodeKind = "income" | "otherIncome" | "shortfall" | "total" | "category" | "surplus";

export type SankeyNode = {
  id: string;
  kind: SankeyNodeKind;
  /** Income row id for `income`, the category for `category`. */
  refId?: string;
  /** How many income rows an `otherIncome` node stands for. */
  count?: number;
  column: 0 | 1 | 2;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the node's label sits; labels are spread so they never overlap. */
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
};

export type SankeyLink = {
  id: string;
  sourceId: string;
  targetId: string;
  value: number;
  /** A cubic curve along the middle of the band; stroke it with `thickness`. */
  path: string;
  thickness: number;
};

export type BudgetSankeyLayout = {
  width: number;
  height: number;
  nodes: SankeyNode[];
  links: SankeyLink[];
};

/** More income rows than this fold the smallest into one "other income" node. */
export const SANKEY_MAX_INCOME_NODES = 6;

const NODE_WIDTH = 12;
const NODE_GAP = 10;
const PAD_TOP = 28;
const PAD_BOTTOM = 8;
const ROW_HEIGHT = 32;
const MIN_HEIGHT = 240;
const LABEL_SPACING = 18;
const LABEL_OFFSET = 6;
const MIN_THICKNESS = 1;
/**
 * Where the middle column sits, as a share of the width. Left of centre: the
 * right column carries up to nine category labels, the left one only income.
 */
const MIDDLE_POSITION = 0.38;

type ColumnEntry = Pick<SankeyNode, "id" | "kind" | "refId" | "count" | "value">;

function incomeEntries(incomes: ReadonlyArray<IncomeRow>): ColumnEntry[] {
  const positive = incomes
    .map((row, index) => ({ row, index, amount: toBudgetAmount(row.amount) }))
    .filter((entry) => entry.amount > 0);

  if (positive.length <= SANKEY_MAX_INCOME_NODES) {
    return positive.map(({ row, amount }) => ({
      id: `income:${row.id}`,
      kind: "income",
      refId: row.id,
      value: amount,
    }));
  }

  const keep = SANKEY_MAX_INCOME_NODES - 1;
  const largest = new Set(
    [...positive]
      .sort((a, b) => b.amount - a.amount || a.index - b.index)
      .slice(0, keep)
      .map((entry) => entry.index),
  );
  const kept = positive.filter((entry) => largest.has(entry.index));
  const folded = positive.filter((entry) => !largest.has(entry.index));

  return [
    ...kept.map(({ row, amount }) => ({
      id: `income:${row.id}`,
      kind: "income" as const,
      refId: row.id,
      value: amount,
    })),
    {
      id: "income:others",
      kind: "otherIncome",
      count: folded.length,
      value: folded.reduce((sum, entry) => sum + entry.amount, 0),
    },
  ];
}

/** Moves label centres apart by at least `spacing`, keeping them inside [min, max]. */
export function spreadLabels(centres: ReadonlyArray<number>, spacing: number, min: number, max: number): number[] {
  const placed = centres.map((centre) => Math.min(Math.max(centre, min), max));
  for (let i = 1; i < placed.length; i++) {
    placed[i] = Math.max(placed[i], placed[i - 1] + spacing);
  }
  const overflow = placed.length > 0 ? placed[placed.length - 1] - max : 0;
  if (overflow > 0) {
    placed[placed.length - 1] = max;
    for (let i = placed.length - 2; i >= 0; i--) {
      placed[i] = Math.min(placed[i], placed[i + 1] - spacing);
    }
  }
  return placed;
}

function bandPath(x0: number, y0: number, x1: number, y1: number): string {
  const mid = (x0 + x1) / 2;
  const f = (value: number) => Number(value.toFixed(2));
  return `M${f(x0)},${f(y0)} C${f(mid)},${f(y0)} ${f(mid)},${f(y1)} ${f(x1)},${f(y1)}`;
}

/**
 * Lays out the diagram for a container `width` wide. Returns null when there is
 * nothing to draw (no income and no expenses).
 */
export function layoutBudgetSankey(
  incomes: ReadonlyArray<IncomeRow>,
  result: HouseholdBudgetResult,
  width: number,
): BudgetSankeyLayout | null {
  const total = Math.max(result.totalIncome, result.totalExpenses);
  if (!(total > 0)) return null;

  const left: ColumnEntry[] = incomeEntries(incomes);
  if (result.balance < 0) {
    left.push({ id: "shortfall", kind: "shortfall", value: -result.balance });
  }

  const right: ColumnEntry[] = result.categories
    .filter((entry) => entry.total > 0)
    .map((entry) => ({
      id: `category:${entry.category}`,
      kind: "category" as const,
      refId: entry.category satisfies BudgetCategory,
      value: entry.total,
    }));
  if (result.balance > 0) {
    right.push({ id: "surplus", kind: "surplus", value: result.balance });
  }

  const rows = Math.max(left.length, right.length, 1);
  const height = Math.max(MIN_HEIGHT, PAD_TOP + PAD_BOTTOM + rows * ROW_HEIGHT);
  const usable = height - PAD_TOP - PAD_BOTTOM - (rows - 1) * NODE_GAP;
  const scale = usable / total;
  const thicknessOf = (value: number) => Math.max(MIN_THICKNESS, value * scale);

  const columnX = [0, Math.round((width - NODE_WIDTH) * MIDDLE_POSITION), width - NODE_WIDTH] as const;
  const middleHeight = total * scale;
  const middleTop = PAD_TOP + (height - PAD_TOP - PAD_BOTTOM - middleHeight) / 2;
  const middleCentre = middleTop + middleHeight / 2;

  const placeColumn = (entries: ColumnEntry[], column: 0 | 2): SankeyNode[] => {
    const heights = entries.map((entry) => entry.value * scale);
    const columnHeight = heights.reduce((sum, h) => sum + h, 0) + (entries.length - 1) * NODE_GAP;
    let y = middleCentre - columnHeight / 2;
    const nodes = entries.map((entry, index) => {
      const node: SankeyNode = {
        ...entry,
        column,
        x: columnX[column],
        y,
        width: NODE_WIDTH,
        height: Math.max(MIN_THICKNESS, heights[index]),
        labelX: column === 0 ? NODE_WIDTH + LABEL_OFFSET : columnX[2] - LABEL_OFFSET,
        labelY: 0,
        labelAnchor: column === 0 ? "start" : "end",
      };
      y += heights[index] + NODE_GAP;
      return node;
    });
    const labelYs = spreadLabels(
      nodes.map((node) => node.y + node.height / 2),
      LABEL_SPACING,
      PAD_TOP + LABEL_SPACING / 2,
      height - PAD_BOTTOM - LABEL_SPACING / 2,
    );
    return nodes.map((node, index) => ({ ...node, labelY: labelYs[index] }));
  };

  const leftNodes = placeColumn(left, 0);
  const rightNodes = placeColumn(right, 2);
  const middle: SankeyNode = {
    id: "total",
    kind: "total",
    column: 1,
    value: total,
    x: columnX[1],
    y: middleTop,
    width: NODE_WIDTH,
    height: middleHeight,
    labelX: columnX[1] + NODE_WIDTH / 2,
    // Above every column: the tallest column starts at PAD_TOP and the other
    // labels are kept below it, so the total's label never collides with them.
    labelY: PAD_TOP - 12,
    labelAnchor: "middle",
  };

  const links: SankeyLink[] = [];
  let inOffset = middleTop;
  for (const node of leftNodes) {
    const thickness = thicknessOf(node.value);
    const band = node.value * scale;
    links.push({
      id: `${node.id}->total`,
      sourceId: node.id,
      targetId: middle.id,
      value: node.value,
      thickness,
      path: bandPath(node.x + NODE_WIDTH, node.y + band / 2, middle.x, inOffset + band / 2),
    });
    inOffset += band;
  }
  let outOffset = middleTop;
  for (const node of rightNodes) {
    const thickness = thicknessOf(node.value);
    const band = node.value * scale;
    links.push({
      id: `total->${node.id}`,
      sourceId: middle.id,
      targetId: node.id,
      value: node.value,
      thickness,
      path: bandPath(middle.x + NODE_WIDTH, outOffset + band / 2, node.x, node.y + band / 2),
    });
    outOffset += band;
  }

  return { width, height, nodes: [...leftNodes, middle, ...rightNodes], links };
}
