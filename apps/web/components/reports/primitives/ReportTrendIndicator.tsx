"use client";

import { ChevronDown, ChevronUp, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface ReportTrendIndicatorProps {
  value: number;
  percentage?: number;
  label?: string;
  direction?: "positive-is-up" | "positive-is-down";
  className?: string;
}

export function ReportTrendIndicator({
  value,
  percentage,
  label,
  direction = "positive-is-up",
  className,
}: ReportTrendIndicatorProps) {
  const t = useTranslations("reports.trend");

  let isPositive: boolean;
  if (direction === "positive-is-up") {
    isPositive = value > 0;
  } else {
    isPositive = value < 0;
  }

  const isFlat = value === 0;
  // Two separate questions. The arrow, the sign and the default word say which
  // way the figure moved; the colour says whether that is good. They used to
  // share `isPositive`, so on a "positive-is-down" figure (spending) a rise
  // drew a down chevron and a minus sign: "-840.3%" for spending that grew.
  const isRising = value > 0;
  const trendLabel =
    label ?? (isFlat ? t("flat") : isRising ? t("up") : t("down"));
  // U+2212, the real minus sign: the hyphen is shorter than the plus and
  // misaligns signed figures in Geist Mono.
  const signedPercentage =
    percentage === undefined
      ? undefined
      : `${isFlat ? "" : isRising ? "+" : "\u2212"}${Math.abs(percentage)}%`;

  const colorClass = isFlat
    ? "text-muted-foreground"
    : isPositive
      ? "text-success-text"
      : "text-destructive-text";

  const Icon = isFlat ? Minus : isRising ? ChevronUp : ChevronDown;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        colorClass,
        className,
      )}
      aria-label={`${trendLabel} ${signedPercentage ?? ""}`.trim()}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="text-sm">{trendLabel}</span>
      {signedPercentage !== undefined ? (
        <span className="font-mono text-sm tabular-nums">
          {signedPercentage}
        </span>
      ) : null}
    </div>
  );
}
