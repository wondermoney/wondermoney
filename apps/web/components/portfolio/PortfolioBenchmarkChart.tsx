"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import React, { useMemo } from "react";

import { type ChartConfig, ChartTooltip } from "@/components/ui/chart";
import {
  AreaLineChartBase,
  useChartFormatters,
} from "@/components/ui/charts";
import { Spinner } from "@/components/ui/Spinner";
import type { Period } from "@/lib/api/portfolio/usePortfolioDashboard";
import usePortfolioPerformance, {
  type PortfolioBenchmarkReadinessStatus,
} from "@/lib/api/portfolio/usePortfolioPerformance";
import { cn } from "@/lib/utils";

interface PortfolioBenchmarkChartProps {
  portfolioId: number | null;
  period: Period;
}

const MAX_X_AXIS_TICKS = 5;
const Y_AXIS_TARGET_TICKS = 5;

function roundTick(value: number) {
  return Number(value.toPrecision(12));
}

function getNiceTickStep(range: number, targetTickCount: number) {
  const roughStep = range / Math.max(targetTickCount - 1, 1);
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / power;
  const multiplier =
    normalizedStep <= 1
      ? 1
      : normalizedStep <= 2
        ? 2
        : normalizedStep <= 5
          ? 5
          : 10;

  return multiplier * power;
}

function buildNiceYTicks(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [-10, 0, 10];
  }

  const minValue = min === max ? min - Math.abs(min || 1) : min;
  const maxValue = min === max ? max + Math.abs(max || 1) : max;
  const step = getNiceTickStep(maxValue - minValue, Y_AXIS_TARGET_TICKS);
  const start = Math.floor(minValue / step) * step;
  const end = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];

  for (let tick = start; tick <= end + step / 2; tick += step) {
    ticks.push(roundTick(tick));
  }

  return ticks;
}

function buildDateTicks(data: { x: string }[]) {
  if (data.length <= MAX_X_AXIS_TICKS) {
    return data.map((point) => point.x);
  }

  const lastIndex = data.length - 1;
  const indexes = new Set<number>();

  for (let index = 0; index < MAX_X_AXIS_TICKS; index += 1) {
    indexes.add(Math.round((index * lastIndex) / (MAX_X_AXIS_TICKS - 1)));
  }

  return Array.from(indexes)
    .toSorted((a, b) => a - b)
    .map((index) => data[index].x);
}

// RAD-575: takes the locale rather than resolving `undefined` to the runtime's.
// The sign is built by hand instead of via `signDisplay` because a chart axis
// wants a bare "0%" at the origin, not "+0%".
function formatAxisPercent(value: number, locale: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  const maximumFractionDigits = Number.isInteger(absValue)
    ? 0
    : absValue < 1
      ? 1
      : 0;

  return `${sign}${new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(absValue)}%`;
}

function getReturnColor(value: number) {
  if (value === 0) return "text-foreground";
  return value > 0 ? "text-success-text" : "text-destructive-text";
}

const PortfolioBenchmarkChart: React.FC<PortfolioBenchmarkChartProps> = ({
  portfolioId,
  period,
}) => {
  const t = useTranslations();
  const locale = useLocale();
  const { formatChartDate, formatPercent } = useChartFormatters();
  // Bound here rather than inside `useChartFormatters` because the axis wants a
  // bare "0%" at the origin, which the shared signed formatter does not give.
  const formatAxisPercentBound = useCallback(
    (value: number) => formatAxisPercent(value, locale),
    [locale],
  );

  const { data: performanceData, isLoading } = usePortfolioPerformance(
    portfolioId,
    period,
  );
  const readiness = performanceData?.readiness?.benchmark;
  const status: PortfolioBenchmarkReadinessStatus =
    readiness?.status ??
    performanceData?.benchmarkStatus ??
    "waiting_for_portfolio_history";

  const chartData = useMemo(() => {
    if (!performanceData?.normalizedDataPoints?.length) {
      return [];
    }

    const portfolioByDate = new Map(
      performanceData.normalizedDataPoints.map((point) => [
        point.date,
        point.value,
      ]),
    );
    const benchmarkByDate = new Map(
      performanceData.normalizedBenchmarkDataPoints?.map((point) => [
        point.date,
        point.value,
      ]) ?? [],
    );

    return Array.from(
      new Set([...portfolioByDate.keys(), ...benchmarkByDate.keys()]),
    )
      .toSorted((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .map((date) => ({
        x: date,
        portfolioReturn: portfolioByDate.get(date),
        benchmarkReturn: benchmarkByDate.get(date),
      }));
  }, [performanceData]);

  const hasBenchmark = chartData.some(
    (point) => typeof point.benchmarkReturn === "number",
  );

  const { min, max } = useMemo(() => {
    if (!chartData.length) {
      return { min: -10, max: 10 };
    }
    const allValues: number[] = [];

    for (const point of chartData) {
      if (typeof point.portfolioReturn === "number") {
        allValues.push(point.portfolioReturn);
      }
      if (typeof point.benchmarkReturn === "number") {
        allValues.push(point.benchmarkReturn);
      }
    }

    return {
      min: Math.min(...allValues),
      max: Math.max(...allValues),
    };
  }, [chartData]);

  const emptyState =
    status === "waiting_for_portfolio_history"
      ? t("portfolio-benchmark-waiting-for-portfolio-history")
      : status === "missing_benchmark_data"
        ? t("portfolio-benchmark-data-unavailable")
        : t("portfolio-benchmark-empty-state");

  const shouldShowChart =
    hasBenchmark && (status === undefined || status === "ready");

  const yTicks = useMemo(() => buildNiceYTicks(min, max), [max, min]);
  const xTicks = useMemo(() => buildDateTicks(chartData), [chartData]);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      portfolioReturn: {
        label: t("portfolio-return"),
        theme: {
          light: "var(--primary)",
          dark: "var(--primary)",
        },
      },
      benchmarkReturn: {
        label: t("benchmark-return"),
        theme: {
          // Deliberately neutral so the brand-coloured portfolio line reads as
          // the primary series. Uses the token rather than a fixed grey so it
          // tracks the theme.
          light: "var(--muted-foreground)",
          dark: "var(--muted-foreground)",
        },
      },
    }),
    [t],
  );

  const benchmarkLabel =
    performanceData?.benchmarkSymbol || t("benchmark-default-label");

  const renderTooltip: React.ComponentProps<typeof ChartTooltip>["content"] = ({
    active,
    label,
    payload,
  }) => {
    if (!active || !payload?.length) return null;

    const portfolioValue = Number(
      payload.find((item) => String(item.dataKey) === "portfolioReturn")?.value,
    );
    const benchmarkValue = Number(
      payload.find((item) => String(item.dataKey) === "benchmarkReturn")?.value,
    );
    const hasPortfolioValue = Number.isFinite(portfolioValue);
    const hasBenchmarkValue = Number.isFinite(benchmarkValue);
    const difference =
      hasPortfolioValue && hasBenchmarkValue
        ? portfolioValue - benchmarkValue
        : null;

    return (
      <div className="border-border/50 bg-background min-w-[10rem] rounded-lg border px-3 py-2 text-xs shadow-xl">
        <div className="mb-2 font-medium">{formatChartDate(label ?? "")}</div>
        <div className="grid gap-1.5">
          {hasPortfolioValue ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                {t("portfolio-return")}
              </span>
              <span
                className={cn(
                  "font-mono font-medium tabular-nums",
                  getReturnColor(portfolioValue),
                )}
              >
                {formatPercent(portfolioValue)}
              </span>
            </div>
          ) : null}
          {hasBenchmarkValue ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                {t("benchmark-return")}
              </span>
              <span
                className={cn(
                  "font-mono font-medium tabular-nums",
                  getReturnColor(benchmarkValue),
                )}
              >
                {formatPercent(benchmarkValue)}
              </span>
            </div>
          ) : null}
          {difference !== null ? (
            <>
              <div className="border-border my-0.5 border-t" />
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{t("difference")}</span>
                <span
                  className={cn(
                    "font-mono font-medium tabular-nums",
                    getReturnColor(difference),
                  )}
                >
                  {formatPercent(difference)}
                </span>
              </div>
            </>
          ) : null}
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
            <p className="text-muted-foreground text-sm">{emptyState}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="h-[300px]">
            <AreaLineChartBase
              data={chartData}
              xKey="x"
              series={[
                { key: "portfolioReturn", type: "line", connectNulls: true },
                { key: "benchmarkReturn", type: "line", connectNulls: true },
              ]}
              config={{
                ...chartConfig,
                benchmarkReturn: {
                  ...chartConfig.benchmarkReturn,
                  label: benchmarkLabel,
                },
              }}
              className="h-full"
              xFormatter={(value) =>
                formatChartDate(value as string | number | Date)
              }
              xTicks={xTicks}
              yFormatter={formatAxisPercentBound}
              yTicks={yTicks}
              showArea={false}
              tooltipContent={renderTooltip}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioBenchmarkChart;
