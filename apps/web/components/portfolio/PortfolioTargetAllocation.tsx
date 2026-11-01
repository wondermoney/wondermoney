"use client";

import { useTranslations } from "next-intl";
import React from "react";

import { Card } from "@/components/ui/card";
import type { AssetClassDrift } from "@/lib/api/portfolio/usePortfolioAllocation";
import { cn } from "@/lib/utils";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface PortfolioTargetAllocationProps {
  driftRows: AssetClassDrift[] | undefined;
}

const PortfolioTargetAllocation: React.FC<PortfolioTargetAllocationProps> = ({
  driftRows,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();

  if (!driftRows?.length) {
    return null;
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        {/* Header row */}
        <div className="text-muted-foreground grid grid-cols-4 gap-2 text-sm font-medium">
          <span>{t("allocation-asset-class")}</span>
          <span className="text-right">{t("current")}</span>
          <span className="text-right">{t("target")}</span>
          <span className="text-right">{t("drift")}</span>
        </div>
        {/* Data rows */}
        {driftRows.map((row) => (
          <div key={row.assetClass} className="grid grid-cols-4 gap-2 text-sm">
            <span className="font-medium">{row.assetClass}</span>
            <span className="text-right">
              {formatPercentage(row.currentPct / 100, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </span>
            <span className="text-right">
              {formatPercentage(row.targetPct / 100, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </span>
            <span
              className={cn(
                "text-right font-medium",
                Math.abs(row.driftPts) > 5
                  ? "text-destructive-text"
                  : Math.abs(row.driftPts) <= 2
                    ? "text-success-text"
                    : "text-warning-text",
              )}
            >
              {formatPercentage(row.driftPts / 100, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
                signDisplay: "exceptZero",
              })}
              {Math.abs(row.driftPts) > 5
                ? ` (${row.driftPts > 0 ? t("allocation-overweight") : t("allocation-underweight")})`
                : Math.abs(row.driftPts) <= 2
                  ? ` (${t("on-target")})`
                  : ""}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default PortfolioTargetAllocation;
