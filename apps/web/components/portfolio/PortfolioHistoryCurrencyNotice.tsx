"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PerformanceResponse } from "@/lib/api/portfolio/usePortfolioPerformance";
import { cn } from "@/lib/utils";

/**
 * Household members can keep different currencies, and the API converts each
 * portfolio's history into the viewer's. On a day with no exchange rate it
 * leaves that portfolio out and lists the day in `completeness`. Says so under
 * the chart; nothing renders when every day converted (or the API predates it).
 */
export function PortfolioHistoryCurrencyNotice({
  completeness,
  className,
}: {
  completeness: PerformanceResponse["completeness"];
  className?: string;
}) {
  const t = useTranslations();
  if (!completeness || completeness.isComplete) return null;
  return (
    <p
      role="note"
      className={cn(
        "text-warning-text flex items-start gap-1.5 text-xs leading-5",
        className,
      )}
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{t("portfolio-history-currency-incomplete")}</span>
    </p>
  );
}
