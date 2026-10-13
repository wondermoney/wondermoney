"use client";

import { BarChart3, Medal, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import type { QuickStats } from "@/lib/api/portfolio/usePortfolioDashboard";
import { cn } from "@/lib/utils";

interface PortfolioQuickStatsProps {
  quickStats: QuickStats;
}

const PortfolioQuickStats: React.FC<PortfolioQuickStatsProps> = ({
  quickStats,
}) => {
  const t = useTranslations();

  const formatMissing = () => t("data-unavailable");

  const statItems = [
    {
      icon: BarChart3,
      label: t("holdings"),
      value:
        quickStats.holdingsCount == null
          ? formatMissing()
          : String(quickStats.holdingsCount),
      subValue: quickStats.holdingsCount == null ? "" : t("assets"),
    },
    {
      icon: Medal,
      label: t("biggest-position"),
      value: quickStats.biggestPosition?.ticker ?? formatMissing(),
      subValue:
        quickStats.biggestPosition?.weight == null
          ? ""
          : `${quickStats.biggestPosition.weight.toFixed(1)}%`,
    },
    {
      icon: TrendingUp,
      label: t("best-performer"),
      value: quickStats.bestPerformer?.ticker ?? formatMissing(),
      subValue:
        quickStats.bestPerformer?.change == null
          ? ""
          : `${quickStats.bestPerformer.change > 0 ? "+" : ""}${quickStats.bestPerformer.change.toFixed(1)}%`,
      tone:
        quickStats.bestPerformer?.change == null
          ? "neutral"
          : quickStats.bestPerformer.change > 0
            ? "positive"
            : "negative",
    },
    {
      icon: TrendingDown,
      label: t("worst-performer"),
      value: quickStats.worstPerformer?.ticker ?? formatMissing(),
      subValue:
        quickStats.worstPerformer?.change == null
          ? ""
          : `${quickStats.worstPerformer.change.toFixed(1)}%`,
      tone:
        quickStats.worstPerformer?.change == null
          ? "neutral"
          : quickStats.worstPerformer.change > 0
            ? "positive"
            : "negative",
    },
  ];

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-4">
        {statItems.map((item) => (
          <div key={item.label} className="flex items-start gap-3">
            <div className="rounded-lg bg-muted p-2">
              <item.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-semibold text-foreground">{item.value}</span>
                {item.subValue && (
                  <span
                    className={cn(
                      "font-mono text-xs",
                      item.tone === "positive"
                        ? "text-success-text"
                        : item.tone === "negative"
                          ? "text-destructive-text"
                          : "text-muted-foreground",
                    )}
                  >
                    {item.subValue}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PortfolioQuickStats;
