"use client";

import { useTranslations } from "next-intl";
import React, { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { type ChartConfig, ChartTooltip } from "@/components/ui/chart";
import {
  AreaLineChartBase,
  useChartFormatters,
} from "@/components/ui/charts";
import { Spinner } from "@/components/ui/Spinner";
import type { Period } from "@/lib/api/portfolio/usePortfolioDashboard";
import usePortfolioPerformance, {
  type PortfolioPerformanceReadinessStatus,
} from "@/lib/api/portfolio/usePortfolioPerformance";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

function getNiceStep(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  const niceNormalized =
    normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10;

  return niceNormalized * magnitude;
}

function buildRoundedTicks(minValue: number, maxValue: number) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [];

  const min = Math.min(minValue, maxValue);
  const max = Math.max(minValue, maxValue);
  const step = getNiceStep(max / 6 || 1);
  const lower = min >= 0 ? 0 : Math.floor(min / step) * step;
  const upper = max <= 0 ? 0 : Math.ceil(max / step) * step;
  const finalUpper = upper === lower ? upper + step : upper;

  return Array.from(
    { length: Math.max(2, Math.round((finalUpper - lower) / step) + 1) },
    (_, index) => Number((lower + index * step).toFixed(6)),
  );
}

type PerformanceTooltipProps = React.ComponentProps<
  typeof ChartTooltip
>["content"];

interface PortfolioPerformanceChartProps {
  portfolioId: number | null;
  period: Period;
  currency?: string;
}

const PortfolioPerformanceChart: React.FC<PortfolioPerformanceChartProps> = ({
  portfolioId,
  period,
  currency = "USD",
}) => {
  const t = useTranslations();
  const { formatChartDate } = useChartFormatters();
  const formatCurrency = useFormatCurrency();

  const { data: performanceData, isLoading } = usePortfolioPerformance(
    portfolioId,
    period,
  );
  const readiness = performanceData?.readiness?.performance;
  const status: PortfolioPerformanceReadinessStatus =
    readiness?.status ?? performanceData?.portfolioHistoryStatus ?? "empty";

  const chartData = useMemo(() => {
    if (!performanceData?.dataPoints?.length) {
      return [];
    }

    return performanceData.dataPoints.map((point) => ({
      x: point.date,
      portfolio: point.value,
    }));
  }, [performanceData]);

  const { min, max } = useMemo(() => {
    if (!performanceData?.dataPoints?.length) {
      return { min: 0, max: 100 };
    }
    const allValues = performanceData.dataPoints.map((p) => p.value);
    return {
      min: Math.min(...allValues),
      max: Math.max(...allValues),
    };
  }, [performanceData]);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      portfolio: {
        label: t("portfolio"),
        color: "var(--primary)",
      },
    }),
    [t],
  );

  const yTicks = useMemo(() => buildRoundedTicks(min, max), [max, min]);

  const xTickCount = useMemo(() => {
    if (!chartData.length) return undefined;

    const baseTickCount =
      period === "1M"
        ? 4
        : period === "3M"
          ? 5
          : period === "6M"
            ? 6
            : period === "YTD"
              ? 6
              : period === "1Y"
                ? 7
                : 8;

    return Math.min(chartData.length, baseTickCount);
  }, [chartData.length, period]);

  const xTicks = useMemo(() => {
    if (!chartData.length || !xTickCount) return undefined;

    if (chartData.length <= xTickCount) {
      return chartData.map((point) => point.x);
    }

    if (xTickCount === 1) {
      return [chartData[Math.floor(chartData.length / 2)]?.x].filter(
        (value): value is string => value !== undefined,
      );
    }

    const sampledIndices = Array.from({ length: xTickCount }, (_, index) =>
      Math.round((index * (chartData.length - 1)) / (xTickCount - 1)),
    );

    return sampledIndices
      .map((index) => chartData[index]?.x)
      .filter((value, index, values): value is string => {
        return value !== undefined && values.indexOf(value) === index;
      });
  }, [chartData, xTickCount]);

  const statusCopy =
    status === "insufficient_history"
      ? t("portfolio-performance-insufficient-history")
      : status === "empty"
        ? t("portfolio-performance-waiting-for-snapshots")
        : t("portfolio-performance-empty-state");

  const shouldShowChart =
    chartData.length > 0 && status !== "empty" && status !== "insufficient_history";

  const renderTooltip: PerformanceTooltipProps = ({
    active,
    label,
    payload,
  }) => {
    if (!active || !payload?.length) return null;

    const value = Number(
      payload.find((item) => String(item.dataKey) === "portfolio")?.value,
    );

    if (!Number.isFinite(value)) return null;

    return (
      <div className="border-border/50 bg-background min-w-[9rem] rounded-lg border px-3 py-2 text-xs shadow-lg">
        <div className="mb-2 font-medium">
          {formatChartDate(label as string | number | Date)}
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t("portfolio")}</span>
          <span className="font-mono font-medium tabular-nums">
            <Amount value={value} currency={currency} />
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="px-5 py-4">
      {isLoading ? (
        <div className="flex h-[300px] items-center justify-center">
          <Spinner />
        </div>
      ) : !shouldShowChart ? (
        <div className="flex h-[300px] items-center justify-center px-6 text-center">
          <div className="max-w-sm space-y-2">
            <p className="text-muted-foreground text-sm">{statusCopy}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="h-[300px]">
            <AreaLineChartBase
              data={chartData}
              xKey="x"
              series={[{ key: "portfolio", type: "area" }]}
              config={chartConfig}
              className="h-full"
              xFormatter={(value) =>
                formatChartDate(value as string | number | Date)
              }
              yFormatter={(value) =>
                formatCurrency(value, currency, { maximumFractionDigits: 0 })
              }
              xTickCount={xTickCount}
              xTicks={xTicks}
              yTicks={yTicks.length ? yTicks : undefined}
              tooltipContent={renderTooltip}
              showLegend={false}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioPerformanceChart;
