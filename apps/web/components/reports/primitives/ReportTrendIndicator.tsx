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
  const trendLabel =
    label ?? (isFlat ? t("flat") : isPositive ? t("up") : t("down"));

  const colorClass = isFlat
    ? "text-muted-foreground"
    : isPositive
      ? "text-success-text"
      : "text-destructive-text";

  const Icon = isFlat
    ? Minus
    : isPositive
      ? ChevronUp
      : ChevronDown;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        colorClass,
        className,
      )}
      aria-label={`${trendLabel} ${percentage !== undefined ? `${percentage}%` : ""}`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="text-sm">{trendLabel}</span>
      {percentage !== undefined ? (
        <span className="font-mono text-sm">
          {`${isPositive ? "+" : isFlat ? "" : "-"}${Math.abs(percentage)}%`}
        </span>
      ) : null}
    </div>
  );
}
