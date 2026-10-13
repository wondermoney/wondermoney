"use client";

import { type LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { Amount, type AmountTone } from "@/components/ui/Amount";
import { LearningTip } from "@/components/ui/learning-tip";
import { cn } from "@/lib/utils";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

/**
 * A headline figure and everything needed to judge it.
 *
 * DESIGN.md § 9 rules 3, 5 and 6. A number on its own tells you a level and
 * nothing else — whether it is good, whether it moved, or how stale it is. The
 * reference never ships one alone: `Gross volume $12,198.72` sits beside
 * `August 27, 2020 $11,556.34` in muted ink at the same size, and the card
 * says when it was last updated underneath.
 *
 * So this card takes three optional companions to the figure:
 *
 * - `comparisonValue` — the same measure last period, muted and adjacent.
 * - `deltaPercent` — the signed change, as a small direction-aware chip.
 * - `helper` — provenance, definition, or unit.
 *
 * `value: null` renders an em-dash, never a zero.
 */
export interface StatCardProps {
  label: string;
  icon?: LucideIcon;
  /** The figure. `null` renders an em-dash. Ignored when `valueNode` is set. */
  value?: number | null;
  currency?: string;
  /** For figures that are not money — counts, ratios, labels. */
  valueNode?: ReactNode;
  /** The same measure over the previous period. Rendered muted, beside. */
  comparisonValue?: number | null;
  /** Names the baseline, e.g. "last period". Required to show a comparison. */
  comparisonLabel?: string;
  /** Signed proportion (0.12 = +12%). Rendered as a direction-aware chip. */
  deltaPercent?: number | null;
  /** Which way is good. `down` for outflow, where a fall is an improvement. */
  positiveDirection?: "up" | "down";
  /**
   * How the figure earns colour. `level` (the default) never colours by sign;
   * `threshold` marks it once it goes negative — a budget that is overspent,
   * for instance.
   */
  tone?: AmountTone;
  /** Muted line under the figure — provenance, definition, unit. */
  helper?: string;
  /**
   * How the figure is arrived at, behind a help icon beside the label.
   *
   * Deliberately icon-only: the budget wizard rendered "How this is
   * calculated" as visible text next to "Monthly income", and the pair wrapped
   * to two lines each inside a tile 200px wide (RAD-619). The sentence is worth
   * having, just not competing with the label for the same row.
   */
  help?: {
    tooltip: ReactNode;
    /** Accessible name for the trigger, e.g. "How monthly income is calculated". */
    ariaLabel: string;
  };
  className?: string;
}

export function StatCard({
  label,
  icon: Icon,
  value,
  currency,
  valueNode,
  comparisonValue,
  comparisonLabel,
  deltaPercent,
  positiveDirection = "up",
  tone,
  helper,
  help,
  className,
}: StatCardProps) {
  const formatPercentage = useFormatPercentage();
  const hasDelta =
    deltaPercent !== null &&
    deltaPercent !== undefined &&
    Number.isFinite(deltaPercent) &&
    deltaPercent !== 0;

  const rose = (deltaPercent ?? 0) > 0;
  const isGood = positiveDirection === "up" ? rose : !rose;
  const TrendIcon = rose ? TrendingUp : TrendingDown;

  const showComparison =
    comparisonLabel !== undefined &&
    comparisonValue !== null &&
    comparisonValue !== undefined;

  return (
    <div
      // Tighter on a phone: three of these stacked at desktop padding spent
      // more of a 390px screen on frame than on figures (RAD-620).
      className={cn("bg-card p-3 sm:p-4", className)}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Sentence case, not letterspaced caps — § 9 density contract. */}
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
          {Icon ? (
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="truncate">{label}</span>
          {help ? (
            <LearningTip
              tooltip={help.tooltip}
              ariaLabel={help.ariaLabel}
              className="text-muted-foreground shrink-0"
            >
              <span className="sr-only">{help.ariaLabel}</span>
            </LearningTip>
          ) : null}
        </div>
        {hasDelta ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs font-medium",
              isGood ? "text-success-text" : "text-destructive-text",
            )}
          >
            <TrendIcon className="size-3" aria-hidden="true" />
            <span className="tabular-nums">
              {formatPercentage(Math.abs(deltaPercent as number))}
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {valueNode ?? (
          <Amount
            value={value}
            currency={currency}
            tone={tone}
            className="font-mono text-xl font-semibold tracking-tight"
          />
        )}
        {showComparison ? (
          <span className="text-muted-foreground text-xs">
            <Amount
              value={comparisonValue}
              currency={currency}
              className="font-mono text-xs"
            />{" "}
            {comparisonLabel}
          </span>
        ) : null}
      </div>

      {helper ? (
        <p className="text-muted-foreground mt-0.5 text-xs">{helper}</p>
      ) : null}
    </div>
  );
}

export function StatCardGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // One hairline-joined block on mobile, separate cells from `sm`.
        // Four individually-bordered, individually-padded boxes stacked down a
        // 360px screen is the "marketing site layout on a working instrument"
        // DESIGN.md §9 calls out — the frames cost more space than the numbers.
        "border-border divide-border grid grid-cols-1 divide-y overflow-hidden rounded-lg border",
        "sm:grid-cols-3 sm:divide-x sm:divide-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export default StatCard;
