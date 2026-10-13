import type { SankeyExtraProperties } from "d3-sankey";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";

export type SankeyNodeKind = "income" | "expense" | "account";

export type SankeyNode = {
  id: string;
  label: string;
  kind: SankeyNodeKind;
  color?: string;
  value?: number;
};

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
};

export type SankeyData = {
  nodes: SankeyNode[];
  links: SankeyLink[];
};

type D3Node = SankeyNode & {
  color: string;
};

type D3Link = SankeyLink;

type D3Input = {
  nodes: D3Node[];
  links: D3Link[];
};

export type SankeyLayoutNode = D3Node & {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

export type SankeyLayoutLink = {
  source: SankeyLayoutNode;
  target: SankeyLayoutNode;
  value: number;
  y0: number;
  y1: number;
  width: number;
  path: string;
};

export type SankeyLayoutResult = {
  nodes: SankeyLayoutNode[];
  links: SankeyLayoutLink[];
  width: number;
  height: number;
  nodeWidth: number;
  columns: number;
  totalValue: number;
};

const KIND_COLUMN: Record<SankeyNodeKind, number> = {
  income: 0,
  expense: 1,
  account: 2,
};

const CHART_PALETTE: Record<SankeyNodeKind, string> = {
  income: "var(--color-chart-1)",
  expense: "var(--color-chart-2)",
  account: "var(--color-chart-3)",
};

export function resolveNodeColor(node: SankeyNode): string {
  return node.color ?? CHART_PALETTE[node.kind];
}

function resolveNodeColumn(node: SankeyNode, columns: number): number {
  return Math.min(KIND_COLUMN[node.kind], columns - 1);
}

function resolveNodeX(
  kind: SankeyNodeKind,
  width: number,
  nodeWidth: number,
): number {
  switch (kind) {
    case "income":
      return 0;
    case "expense":
      return (width - nodeWidth) / 2;
    case "account":
    default:
      return width - nodeWidth;
  }
}

export function computeSankeyLayout(
  data: SankeyData,
  options: {
    width: number;
    height: number;
    nodeWidth?: number;
    nodePadding?: number;
  },
): SankeyLayoutResult {
  const { width, height } = options;
  const nodeWidth = options.nodeWidth ?? 20;
  const nodePadding = options.nodePadding ?? 16;

  const hasAccount = data.nodes.some((node) => node.kind === "account");
  const columns = hasAccount ? 3 : 2;

  const nodes = data.nodes.map((node): D3Node => {
    return {
      ...node,
      color: resolveNodeColor(node),
    };
  });

  const links = data.links.map((link): D3Link => ({ ...link }));

  const generator = sankey<D3Input, D3Node, D3Link & SankeyExtraProperties>()
    .nodeId((node) => node.id)
    .nodeAlign((node) => resolveNodeColumn(node, columns))
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .extent([
      [0, 0],
      [width, height],
    ]);

  const graph = generator({ nodes, links });
  const linkGenerator = sankeyLinkHorizontal<D3Node, D3Link>();

  // Re-position nodes into the fixed income/expense/account columns. d3-sankey
  // derives columns from graph depth, but our data can contain direct links from
  // income to account while still expecting account nodes on the far right.
  const positionedNodes = graph.nodes.map((node): SankeyLayoutNode => {
    const x = resolveNodeX(node.kind, width, nodeWidth);

    return {
      ...node,
      color: node.color,
      x0: x,
      x1: x + nodeWidth,
      y0: node.y0 ?? 0,
      y1: node.y1 ?? 0,
    };
  });

  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));

  const totalValue = data.links.reduce((sum, link) => sum + link.value, 0);

  return {
    nodes: positionedNodes,
    links: graph.links.map((link): SankeyLayoutLink => {
      const sourceNode = link.source as SankeyLayoutNode;
      const targetNode = link.target as SankeyLayoutNode;
      const source = nodeById.get(sourceNode.id)!;
      const target = nodeById.get(targetNode.id)!;

      const positionedLink = {
        source,
        target,
        value: link.value,
        y0: link.y0 ?? 0,
        y1: link.y1 ?? 0,
        width: link.width ?? 0,
      };

      return {
        source,
        target,
        value: link.value,
        y0: link.y0 ?? 0,
        y1: link.y1 ?? 0,
        width: link.width ?? 0,
        path: linkGenerator(positionedLink as unknown as D3Link) ?? "",
      };
    }),
    width,
    height,
    nodeWidth,
    columns,
    totalValue,
  };
}
