"use client";

import { useTranslations } from "next-intl";
import React from "react";

import type { QuickStats } from "@/lib/api/portfolio/usePortfolioDashboard";
import { cn } from "@/lib/utils";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface PortfolioQuickStatsProps {
  quickStats: QuickStats;
}

const PortfolioQuickStats: React.FC<PortfolioQuickStatsProps> = ({
  quickStats,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  const signedOneDecimal = {
    ...oneDecimal,
    signDisplay: "exceptZero" as const,
  };

  const formatMissing = () => t("data-unavailable");

  const statItems = [
    {
      label: t("holdings"),
      value:
        quickStats.holdingsCount == null
          ? formatMissing()
          : String(quickStats.holdingsCount),
      subValue: quickStats.holdingsCount == null ? "" : t("assets"),
      subValueIsWord: true,
    },
    {
      label: t("biggest-position"),
      value: quickStats.biggestPosition?.ticker ?? formatMissing(),
      subValue:
        quickStats.biggestPosition?.weight == null
          ? ""
          : formatPercentage(
              quickStats.biggestPosition.weight / 100,
              oneDecimal,
            ),
    },
    {
      label: t("best-performer"),
      value: quickStats.bestPerformer?.ticker ?? formatMissing(),
      subValue:
        quickStats.bestPerformer?.change == null
          ? ""
          : formatPercentage(quickStats.bestPerformer.change / 100, signedOneDecimal),
      tone:
        quickStats.bestPerformer?.change == null
          ? "neutral"
          : quickStats.bestPerformer.change > 0
            ? "positive"
            : "negative",
    },
    {
      label: t("worst-performer"),
      value: quickStats.worstPerformer?.ticker ?? formatMissing(),
      subValue:
        quickStats.worstPerformer?.change == null
          ? ""
          : formatPercentage(quickStats.worstPerformer.change / 100, signedOneDecimal),
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
          <div key={item.label} className="flex items-start">
            {/* No icon tile: the trend arrows were fixed per row, so "best
                performer" showed a rising arrow even on a loss. The signed,
                coloured figure carries the direction. */}
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-semibold text-foreground">{item.value}</span>
                {item.subValue && (
                  <span
                    className={cn(
                      "text-xs",
                      !item.subValueIsWord && "font-mono",
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
