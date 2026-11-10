"use client";

import { format } from "date-fns";
import { AlertCircle, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { ExportCsvButton } from "@/components/reports/export/ExportCsvButton";
import { useReportFilters } from "@/components/reports/filters/useReportFilters";
import {
  ReportAmount,
  ReportCard,
  ReportEmptyState,
  ReportErrorState,
  ReportLoadingSkeleton,
  ReportTrendIndicator,
} from "@/components/reports/primitives";
import { useReportsCurrency } from "@/components/reports/ReportsCurrencyContext";
import type { ChartConfig } from "@/components/ui/chart";
import { AreaLineChartBase } from "@/components/ui/charts/area-line-chart-base";
import useNetWorthHistory, {
  getNetWorthHistory,
} from "@/lib/api/reports/netWorthHistory";
import {
  monthlyNetWorthPoints,
  netWorthAxisLabels,
} from "@/lib/reports/net-worth-labels";
import { periodTrend } from "@/lib/reports/period-trend";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

export function NetWorthHistoryReport() {
  const t = useTranslations("reports.reports.netWorthHistory");
  const tCommon = useTranslations("reports.common");
  const { filters } = useReportFilters();
  const locale = useLocale();
  const formatAmountText = useFormatCurrency();
  const { currencyKey } = useReportsCurrency();
  const { data, isPending, error, refetch } = useNetWorthHistory(filters);

  const filename = useMemo(
    () => `reports/net-worth-history-${format(new Date(), "yyyy-MM-dd")}`,
    [],
  );

  const requestCsv = useMemo(
    () => async () => getNetWorthHistory({ ...filters, format: "csv" }),
    [filters],
  );

  const chartData = useMemo(() => {
    if (!data?.data) return [];
    const monthly = monthlyNetWorthPoints(data.data);
    const labels = netWorthAxisLabels(
      monthly.map((point) => point.date),
      locale,
    );
    return monthly.map((point, index) => ({
      date: point.date,
      month: labels[index],
      netWorth: point.netWorth,
    }));
  }, [data, locale]);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      netWorth: {
        label: t("netWorth"),
        color: "var(--color-chart-1)",
      },
    }),
    [t],
  );

  const trend = useMemo(() => {
    const points = data?.data ? monthlyNetWorthPoints(data.data) : undefined;
    // No earlier month to compare against: no delta and no ratio.
    if (!points || points.length < 2) {
      return { delta: 0, percent: undefined };
    }
    return periodTrend(
      points[points.length - 1].netWorth,
      points[points.length - 2].netWorth,
    );
  }, [data]);

  const latestBreakdown = data?.data.at(-1)?.breakdown;

  return (
    <ReportCard
      title={t("title")}
      subtitle={t("subtitle")}
      headerActions={
        <>
          <ExportCsvButton
            requestFn={requestCsv}
            filename={filename}
            format="blob"
          />
          <ReportTrendIndicator
            value={trend.delta}
            percentage={trend.percent}
          />
        </>
      }
      data-testid="net-worth-history-report"
    >
      {isPending ? (
        <ReportLoadingSkeleton kind="area-line" />
      ) : error ? (
        <ReportErrorState
          icon={AlertCircle}
          error={error}
          title={tCommon("error")}
          description={tCommon("errorDescription")}
          retryLabel={tCommon("retry")}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <ReportEmptyState
          icon={TrendingUp}
          title={t("noData.title")}
          description={t("noData.description")}
        />
      ) : (
        <>
          <AreaLineChartBase
            data={chartData}
            xKey="month"
            series={[{ key: "netWorth", type: "area" }]}
            config={chartConfig}
            className="h-[420px]"
            yFormatter={(value) =>
              formatAmountText(value, currencyKey, {
                notation: "compact",
                maximumFractionDigits: 0,
              })
            }
            tooltipValueFormatter={(value) => (
              <span className="font-mono whitespace-nowrap tabular-nums">
                {formatAmountText(Number(value), currencyKey, {
                  maximumFractionDigits: 2,
                })}
              </span>
            )}
          />
          {latestBreakdown ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="bg-chart-2 size-2 rounded-full" />
                <span className="text-muted-foreground">{t("assets")}</span>
                <ReportAmount
                  value={latestBreakdown.assets}
                  currencyKey={currencyKey}
                  className="font-medium"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-chart-3 size-2 rounded-full" />
                <span className="text-muted-foreground">
                  {t("liabilities")}
                </span>
                <ReportAmount
                  value={latestBreakdown.liabilities}
                  currencyKey={currencyKey}
                  className="font-medium"
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </ReportCard>
  );
}
