"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import type { PortfolioFlowKind } from "@/lib/portfolio/performance-chart-data";
import { cn } from "@/lib/utils";

/**
 * Money going in or out is not a gain or a loss, so the marks stay neutral ink
 * and say which way by shape: a triangle up for a deposit, down for a
 * withdrawal, a ring for a trade with no amount in the viewer's currency.
 */
function flowGlyphPath(kind: PortfolioFlowKind, cx: number, cy: number) {
  const r = 4.5;
  if (kind === "deposit") {
    return `M${cx},${cy - r} L${cx + r},${cy + r * 0.8} L${cx - r},${cy + r * 0.8} Z`;
  }
  if (kind === "withdrawal") {
    return `M${cx},${cy + r} L${cx + r},${cy - r * 0.8} L${cx - r},${cy - r * 0.8} Z`;
  }
  return null;
}

/** A flow day's mark on the value line, for a Recharts `ReferenceDot` shape. */
export function FlowMarkerShape({
  kind,
  cx,
  cy,
}: {
  kind: PortfolioFlowKind;
  cx?: number;
  cy?: number;
}) {
  if (cx == null || cy == null) return <g />;
  const path = flowGlyphPath(kind, cx, cy);
  return (
    <g aria-hidden="true" data-flow={kind}>
      {path ? (
        <path
          d={path}
          fill="var(--background)"
          stroke="var(--foreground)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={3.5}
          fill="var(--background)"
          stroke="var(--foreground)"
          strokeWidth={1.5}
        />
      )}
    </g>
  );
}

function FlowGlyph({ kind }: { kind: PortfolioFlowKind }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className="size-3 shrink-0 overflow-visible"
    >
      <FlowMarkerShape kind={kind} cx={6} cy={6} />
    </svg>
  );
}

/** The tooltip line for a flow day: which way the money moved, and how much. */
export function FlowTooltipRow({
  netContribution,
  currency,
}: {
  netContribution: number | null;
  currency: string;
}) {
  const t = useTranslations();
  if (netContribution === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-1.5">
        <FlowGlyph kind="unknown" />
        <span>{t("portfolio-flow-unknown")}</span>
      </div>
    );
  }
  const kind = netContribution > 0 ? "deposit" : "withdrawal";
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground flex items-center gap-1.5">
        <FlowGlyph kind={kind} />
        {kind === "deposit"
          ? t("portfolio-flow-deposit")
          : t("portfolio-flow-withdrawal")}
      </span>
      <span className="font-mono font-medium tabular-nums">
        <Amount value={Math.abs(netContribution)} currency={currency} />
      </span>
    </div>
  );
}

/** Says what the marks mean, listing only the kinds the chart shows. */
export function FlowMarkerLegend({
  kinds,
  className,
}: {
  kinds: PortfolioFlowKind[];
  className?: string;
}) {
  const t = useTranslations();
  if (kinds.length === 0) return null;
  const label: Record<PortfolioFlowKind, string> = {
    deposit: t("portfolio-flow-deposit"),
    withdrawal: t("portfolio-flow-withdrawal"),
    unknown: t("portfolio-flow-unknown"),
  };
  return (
    <ul
      aria-label={t("portfolio-flow-legend")}
      className={cn(
        "text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs",
        className,
      )}
    >
      {(["deposit", "withdrawal", "unknown"] as const)
        .filter((kind) => kinds.includes(kind))
        .map((kind) => (
          <li key={kind} className="flex items-center gap-1.5">
            <FlowGlyph kind={kind} />
            {label[kind]}
          </li>
        ))}
    </ul>
  );
}
