"use client";

import { format } from "date-fns";
import { AlertCircle, ArrowLeftRight } from "lucide-react";
import { useReducedMotion } from "motion/react";
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
import {
  ComposedAreaBarChartBase,
  useChartFormatters,
} from "@/components/ui/charts";
import useCashflow, { getCashflow } from "@/lib/api/reports/cashflow";
import {
  buildCashflowSeries,
  type CashflowSeriesPoint,
  findPartialMonth,
  getTrailingNetAverage,
} from "@/lib/reports/cashflow-series";
import { formatCurrencyForLocale } from "@/lib/utils/formatCurrency";

export function CashflowReport() {
  const t = useTranslations("reports.reports.cashflow");
  const { formatChartMonth } = useChartFormatters();
  const tCommon = useTranslations("reports.common");
  const { filters } = useReportFilters();
  const locale = useLocale();
  const { currencyKey } = useReportsCurrency();
  const shouldReduceMotion = useReducedMotion();

  const { data, isPending, error, refetch } = useCashflow(filters);

  // The series is rebuilt against the selected period rather than plotted as
  // returned: the API emits a row only for months that have transactions, so
  // the raw response silently omits months inside the period — and can still
  // carry one outside it whenever the request could not name the viewer's
  // calendar. See lib/reports/cashflow-series.
  const chartData = useMemo(
    () =>
      buildCashflowSeries(data?.data, {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      }),
    [data, filters.fromDate, filters.toDate],
  );

  const trailingNetAverage = useMemo(
    () => getTrailingNetAverage(chartData),
    [chartData],
  );

  const partialMonth = useMemo(() => findPartialMonth(chartData), [chartData]);

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long" }),
    [locale],
  );

  const filename = useMemo(
    () => `reports/cashflow-${format(new Date(), "yyyy-MM-dd")}`,
    [],
  );

  const requestCsv = useMemo(
    () => async () => getCashflow({ ...filters, format: "csv" }),
    [filters],
  );

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      income: {
        label: t("income"),
        color: "var(--chart-1)",
      },
      expenses: {
        label: t("expenses"),
        color: "var(--chart-2)",
      },
      net: {
        label: t("net"),
        color: "var(--chart-3)",
      },
    }),
    [t],
  );

  return (
    <ReportCard
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        partialMonth ? (
          <p className="text-muted-foreground text-xs">
            {t(
              partialMonth.isCurrentMonth
                ? "partial.footnoteCurrent"
                : "partial.footnoteRange",
              { month: monthFormatter.format(new Date(partialMonth.month)) },
            )}
          </p>
        ) : undefined
      }
      headerActions={
        <>
          <ExportCsvButton
            requestFn={requestCsv}
            filename={filename}
            format="blob"
          />
          <ReportTrendIndicator
            value={trailingNetAverage}
            direction="positive-is-up"
            label={t("trailingNetAverage")}
          />
        </>
      }
      data-testid="cashflow-report"
    >
      {isPending ? (
        <ReportLoadingSkeleton kind="line" />
      ) : error ? (
        <ReportErrorState
          icon={AlertCircle}
          error={error}
          title={tCommon("error")}
          description={tCommon("errorDescription")}
          retryLabel={tCommon("retry")}
          onRetry={() => void refetch()}
        />
      ) : chartData.length === 0 ? (
        <ReportEmptyState
          icon={ArrowLeftRight}
          title={t("noData.title")}
          description={t("noData.description")}
        />
      ) : (
        <ComposedAreaBarChartBase
          data={chartData}
          xKey="month"
          areaKeys={["income"]}
          barKeys={["expenses"]}
          lineKeys={["net"]}
          config={chartConfig}
          isAnimationActive={!shouldReduceMotion}
          connectNulls={false}
          provisionalKey="isPartial"
          xFormatter={(value) => formatChartMonth(String(value))}
          tooltipLabelFormatter={(_label, payload) => {
            const point = payload?.[0]?.payload as
              | CashflowSeriesPoint
              | undefined;
            if (!point) return null;
            const month = formatChartMonth(point.month);
            if (!point.isPartial) return month;
            return `${month} · ${t(
              point.isCurrentMonth
                ? "partial.monthToDate"
                : "partial.partialMonth",
            )}`;
          }}
          yFormatter={(value) =>
            formatCurrencyForLocale(Number(value), currencyKey, locale, {
              notation: "compact",
              maximumFractionDigits: 0,
            })
          }
          tooltipValueFormatter={(value) => (
            <ReportAmount value={Number(value)} currencyKey={currencyKey} />
          )}
        />
      )}
    </ReportCard>
  );
}
