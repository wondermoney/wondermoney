"use client";

import { useTranslations } from "next-intl";
import React, { useMemo } from "react";

import { type ChartConfig, ChartTooltip } from "@/components/ui/chart";
import {
  AreaLineChartBase,
  niceTicks,
  useChartFormatters,
} from "@/components/ui/charts";
import { Spinner } from "@/components/ui/Spinner";
import { useNetWorthHistory } from "@/lib/api/net-worth/useNetWorth";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

type TooltipContentProps = React.ComponentProps<typeof ChartTooltip>["content"];

interface DashboardNetWorthHistoryChartProps {
  currencyCode: string;
}

export default function DashboardNetWorthHistoryChart({
  currencyCode,
}: DashboardNetWorthHistoryChartProps) {
  const t = useTranslations();
  const { formatChartDate } = useChartFormatters();
  const { data, isLoading, isError } = useNetWorthHistory(6, "monthly");

  const completePoints = useMemo(
    () =>
      (data?.points ?? []).filter(
        (point) => point.isComplete && point.totalNetWorth !== null,
      ),
    [data],
  );

  const chartData = useMemo(() => {
    return completePoints.map((point) => ({
      x: point.date,
      netWorth: point.totalNetWorth,
    }));
  }, [completePoints]);

  // Rounded, evenly spaced ticks rather than the padded extremes — the padded
  // window puts the labels on arbitrary values, and the axis gutter is sized
  // from the labels themselves so the plot does not start far to the right.
  // Same helper the explorer's price axis uses.
  const yTicks = useMemo<number[]>(() => {
    const values = completePoints.map((point) => point.totalNetWorth ?? 0);

    if (!values.length) {
      return niceTicks(0, 100, 5);
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding =
      min === max ? Math.abs(min || 1) * 0.06 : (max - min) * 0.08;

    return niceTicks(min - padding, max + padding, 5);
  }, [completePoints]);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      netWorth: {
        label: t("net-worth"),
        color: "var(--chart-1)",
      },
    }),
    [t],
  );
  const formatCurrency = useFormatCurrency();

  const status = data?.readiness ?? (isError ? "empty" : undefined);
  const hasReliableHistory =
    status === "ready" && completePoints.length >= 2 && chartData.length >= 2;

  const tooltipContent: TooltipContentProps = ({ active, label, payload }) => {
    if (!active || !payload?.length) return null;

    const value = Number(
      payload.find((item) => String(item.dataKey) === "netWorth")?.value,
    );

    if (!Number.isFinite(value)) return null;

    return (
      <div className="border-border/50 bg-background min-w-[10rem] rounded-lg border px-3 py-2 text-xs">
        <div className="text-foreground mb-2 font-medium">
          {formatChartDate(label as string | number | Date)}
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t("net-worth")}</span>
          <span className="font-mono font-medium tabular-nums">
            {formatCurrency(value, currencyCode, { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>
    );
  };

  if (isLoading && !data) {
    return (
      <div className="border-border/60 bg-card flex h-[260px] items-center justify-center rounded-lg border">
        <Spinner />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="border-border/60 bg-card flex h-[260px] items-center justify-center rounded-lg border px-6 text-center">
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      </div>
    );
  }

  if (!hasReliableHistory) {
    const copy =
      status === "empty"
        ? t("net-worth-history-empty")
        : t("net-worth-history-insufficient");

    return (
      <div className="border-border/60 bg-card flex h-[260px] items-center justify-center rounded-lg border px-6 text-center">
        <p className="text-muted-foreground max-w-sm text-sm leading-6">
          {copy}
        </p>
      </div>
    );
  }

  return (
    <div className="border-border/60 bg-card rounded-lg border px-3 py-3">
      <AreaLineChartBase
        data={chartData}
        xKey="x"
        series={[{ key: "netWorth", type: "area" }]}
        config={chartConfig}
        className="h-[260px]"
        yTicks={yTicks}
        xFormatter={(value) => formatChartDate(value as string | number | Date)}
        yFormatter={(value) =>
          formatCurrency(value, currencyCode, { maximumFractionDigits: 0 })
        }
        tooltipContent={tooltipContent}
        showLegend={false}
      />
    </div>
  );
}
