"use client";

import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import React, { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ChartConfig } from "@/components/ui/chart";
import { PieChartBase } from "@/components/ui/charts";
import { Spinner } from "@/components/ui/Spinner";
import usePortfolioAllocation from "@/lib/api/portfolio/usePortfolioAllocation";
import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";
import { formatCurrencyForLocale } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface PortfolioAllocationChartProps {
  portfolioId: number | null;
  currency: SupportedCurrencyCodes;
  showSectorToggle?: boolean;
}

/**
 * Takes the locale explicitly rather than letting `Intl` fall back to
 * the runtime's. Exported for the chart's own test, which is why it is a plain
 * function and not the hook.
 */
export const formatPortfolioAllocationValue = (
  value: number,
  currency: SupportedCurrencyCodes,
  locale: string,
) => formatCurrencyForLocale(value, currency, locale);

// The project's validated categorical ramp, in order. This replaced eight raw
// hexes that tracked neither theme and had never been checked for
// colour-vision separation (slop-test gate 48). See DESIGN.md § The chart ramp.
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Beyond the ramp, slices share one neutral rather than restarting it. The old
// code did `COLORS[index % COLORS.length]`, so a portfolio with nine or more
// slices gave two of them the *same* colour — and this chart renders with
// `showLegend={false}`, which makes colour the only identity channel. A
// deliberate "not individually coloured" neutral is honest; a silent duplicate
// is not. Assign in order, never cycle.
const OVERFLOW_COLOR = "var(--muted-foreground)";

const UNCLASSIFIED_COLOR = "var(--muted)"; // deliberately outside the ramp

const PortfolioAllocationChart: React.FC<PortfolioAllocationChartProps> = ({
  portfolioId,
  currency,
  showSectorToggle = false,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const shouldReduceMotion = useReducedMotion();
  const formatCurrency = useFormatCurrency();
  const [viewMode, setViewMode] = useState<"type" | "sector" | "asset">("type");

  const { data: allocationData, isLoading } =
    usePortfolioAllocation(portfolioId);

  const chartData = useMemo(() => {
    if (!allocationData) {
      return [];
    }

    const items =
      viewMode === "type"
        ? allocationData.byType
        : viewMode === "sector"
          ? allocationData.bySector
          : allocationData.byAsset;
    if (!items?.length) {
      return [];
    }

    return items.map((item, index) => ({
      chartKey: `allocation-${index}`,
      id: item.type,
      label: item.type,
      value: item.percentage,
      rawValue: item.value,
      color:
        item.type === "Unclassified"
          ? UNCLASSIFIED_COLOR
          : (COLORS[index] ?? OVERFLOW_COLOR),
    }));
  }, [allocationData, viewMode]);

  const chartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        chartData.map((item) => [
          item.chartKey,
          { label: item.label, color: item.color },
        ]),
      ),
    [chartData],
  );

  const hasPricedAllocation = chartData.some(
    (item) => item.value > 0 || item.rawValue > 0,
  );
  const hasAllocation = chartData.length > 0 && hasPricedAllocation;
  const emptyState = t("portfolio-allocation-empty-state");
  const emptyNote = t("portfolio-allocation-empty-note");
  const pricingUnavailable = t("portfolio-allocation-pricing-unavailable");
  const pricingUnavailableNote = t(
    "portfolio-allocation-pricing-unavailable-note",
  );

  return (
    <div className="p-4">
      {showSectorToggle && (
        <div className="mb-3 flex gap-1">
          <Button
            size="xs"
            variant={viewMode === "type" ? "default" : "secondary"}
            aria-pressed={viewMode === "type"}
            onClick={() => setViewMode("type")}
            className="h-6 text-xs"
          >
            {t("by-type")}
          </Button>
          {allocationData?.bySector && (
            <Button
              size="xs"
              variant={viewMode === "sector" ? "default" : "secondary"}
              aria-pressed={viewMode === "sector"}
              onClick={() => setViewMode("sector")}
              className="h-6 text-xs"
            >
              {t("by-sector")}
            </Button>
          )}
          {allocationData?.byAsset && (
            <Button
              size="xs"
              variant={viewMode === "asset" ? "default" : "secondary"}
              aria-pressed={viewMode === "asset"}
              onClick={() => setViewMode("asset")}
              className="h-6 text-xs"
            >
              {t("by-asset")}
            </Button>
          )}
        </div>
      )}
      {isLoading ? (
        <div className="flex h-62.5 items-center justify-center">
          <Spinner />
        </div>
      ) : !hasAllocation ? (
        <div className="flex h-62.5 items-center justify-center px-6 text-center">
          <div className="max-w-sm space-y-2">
            <p className="text-muted-foreground text-sm">
              {chartData.length === 0 ? emptyState : pricingUnavailable}
            </p>
            <p className="text-muted-foreground text-xs leading-5">
              {chartData.length === 0 ? emptyNote : pricingUnavailableNote}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="w-full md:w-1/2">
            <PieChartBase
              data={chartData}
              config={chartConfig}
              nameKey="chartKey"
              valueKey="value"
              showLegend={false}
              isAnimationActive={!shouldReduceMotion}
              className="mx-auto h-70 md:h-80"
              tooltipFormatter={(value, name, item) => (
                <div className="flex w-full items-start justify-between gap-3">
                  <div className="grid gap-0.5">
                    <span className="text-muted-foreground">
                      {chartConfig[String(name)]?.label ??
                        item.payload?.label ??
                        name}
                    </span>
                    <span className="text-foreground font-mono tabular-nums">
                      {formatCurrency(
                        Number(item.payload?.rawValue ?? 0),
                        currency,
                      )}
                    </span>
                  </div>
                  <span className="text-muted-foreground font-mono font-medium tabular-nums">
                    {formatPercentage(Number(value) / 100, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </span>
                </div>
              )}
            />
          </div>
          <div className="flex flex-col gap-2 md:w-1/2">
            {chartData.map((item, index) => (
              <div
                key={item.chartKey}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-foreground text-sm">{item.label}</span>
                </div>
                <span className="text-foreground font-mono text-sm font-medium">
                  {formatPercentage(item.value / 100, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioAllocationChart;
