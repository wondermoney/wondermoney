import { useEffect, useMemo, useRef, useState } from "react";
import {
  layoutBudgetSankey,
  type SankeyNode,
  type SankeyNodeKind,
} from "@/lib/calculators/budgetSankey";
import type { HouseholdBudgetResult, IncomeRow } from "@/lib/calculators/householdBudget";

/** Width the prerendered markup is laid out for, before the browser measures. */
const DEFAULT_WIDTH = 520;
const LABEL_FONT_PX = 12;
/** Rough widths of one label character (name, mono figure), used to shorten long names. */
const CHAR_PX = 6.6;
const MONO_CHAR_PX = 7.3;
/** A left-column node at least this tall shows its figure under its name. */
const STACK_MIN_HEIGHT = 34;

type Swatch = { fill: string; link: string; linkOpacity: number };

// Identity comes from the direct labels; colour only separates where money
// comes from, the month's total, where it goes, and the surplus or shortfall.
const SWATCH: Record<SankeyNodeKind, Swatch> = {
  income: { fill: "oklch(var(--chart-1))", link: "oklch(var(--chart-1))", linkOpacity: 0.22 },
  otherIncome: { fill: "oklch(var(--chart-1))", link: "oklch(var(--chart-1))", linkOpacity: 0.22 },
  shortfall: { fill: "oklch(var(--destructive))", link: "oklch(var(--destructive))", linkOpacity: 0.28 },
  total: { fill: "oklch(var(--muted-foreground))", link: "oklch(var(--muted-foreground))", linkOpacity: 0.12 },
  category: { fill: "oklch(var(--ink-2))", link: "oklch(var(--ink-2))", linkOpacity: 0.14 },
  surplus: { fill: "oklch(var(--success))", link: "oklch(var(--success))", linkOpacity: 0.4 },
};

type Props = {
  incomes: ReadonlyArray<IncomeRow>;
  result: HouseholdBudgetResult;
  labelFor: (node: SankeyNode) => string;
  formatMoney: (value: number) => string;
  title: string;
  description: string;
};

function shorten(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export default function BudgetSankey({ incomes, result, labelFor, formatMoney, title, description }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutBudgetSankey(incomes, result, width), [incomes, result, width]);

  if (!layout) return <div ref={wrapperRef} />;

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const middle = layout.nodes.find((node) => node.kind === "total");
  const middleX = middle ? middle.x : width / 2;
  // Left labels run from the left nodes towards the middle column, right labels
  // back from the right nodes towards it.
  const roomFor = (node: SankeyNode) =>
    node.column === 0 ? middleX - node.labelX - 8 : node.labelX - middleX - 20;

  return (
    <div ref={wrapperRef} className="w-full">
      <svg
        role="img"
        aria-labelledby="hbSankeyTitle hbSankeyDesc"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block max-w-full"
      >
        <title id="hbSankeyTitle">{title}</title>
        <desc id="hbSankeyDesc">{description}</desc>

        <g fill="none">
          {layout.links.map((link) => {
            const coloured = nodeById.get(link.targetId === "total" ? link.sourceId : link.targetId);
            const swatch = SWATCH[coloured?.kind ?? "category"];
            return (
              <path
                key={link.id}
                d={link.path}
                style={{ stroke: swatch.link }}
                strokeOpacity={swatch.linkOpacity}
                strokeWidth={link.thickness}
              >
                <title>{`${coloured ? labelFor(coloured) : ""}: ${formatMoney(link.value)}`}</title>
              </path>
            );
          })}
        </g>

        <g>
          {layout.nodes.map((node) => (
            <rect
              key={node.id}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={2}
              style={{ fill: SWATCH[node.kind].fill }}
            >
              <title>{`${labelFor(node)}: ${formatMoney(node.value)}`}</title>
            </rect>
          ))}
        </g>

        <g aria-hidden="true" fontSize={LABEL_FONT_PX} style={{ fill: "oklch(var(--foreground))" }}>
          {layout.nodes.map((node) => {
            const value = formatMoney(node.value);
            const valueWidth = (value.length + 1) * MONO_CHAR_PX;
            // Income labels have the least room, so a tall income node puts the
            // figure on a second line and gives the name the whole width.
            const stacked = node.column === 0 && node.height >= STACK_MIN_HEIGHT;
            const room = node.kind === "total" ? width : roomFor(node) - (stacked ? 0 : valueWidth);
            const name = shorten(labelFor(node), Math.max(5, Math.floor(room / CHAR_PX)));
            // The total's label is centred over its node but kept inside the drawing.
            const halfWidth = (name.length * CHAR_PX + valueWidth) / 2;
            const x =
              node.kind === "total"
                ? Math.min(Math.max(node.labelX, halfWidth), width - halfWidth)
                : node.labelX;
            return (
              <text
                key={node.id}
                x={x}
                y={node.labelY}
                dy={stacked ? "-0.25em" : "0.35em"}
                textAnchor={node.labelAnchor}
                style={{
                  paintOrder: "stroke",
                  stroke: "oklch(var(--background))",
                  strokeWidth: 3,
                  strokeLinejoin: "round",
                }}
              >
                <tspan>{name}</tspan>
                {stacked ? (
                  <tspan x={x} dy="1.2em" className="font-mono" style={{ fill: "oklch(var(--ink-2))" }}>
                    {value}
                  </tspan>
                ) : (
                  <tspan dx="0.3em" className="font-mono" style={{ fill: "oklch(var(--ink-2))" }}>
                    {value}
                  </tspan>
                )}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
