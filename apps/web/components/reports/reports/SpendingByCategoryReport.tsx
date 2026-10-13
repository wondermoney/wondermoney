"use client";

import { format } from "date-fns";
import { AlertCircle, PieChart } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

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
import { BarChartBase } from "@/components/ui/charts";
import useCategories from "@/lib/api/category/useCategories";
import useSpendingByCategory, {
  getSpendingByCategory,
} from "@/lib/api/reports/spendingByCategory";
import type { ReportFilters, SpendingByCategoryRow } from "@/lib/api/reports/types";
import { periodTrend } from "@/lib/reports/period-trend";
import {
  getAllCategories,
  getCategoryTranslationKey,
} from "@/lib/utils/categories";
import { resolveCategoryColor } from "@/lib/utils/categoryColor";
import { formatCurrencyForLocale } from "@/lib/utils/formatCurrency";

const TOP_CATEGORY_COUNT = 12;
// `hsl(var(--muted-foreground))` — but this project's tokens are complete
// oklch() values, not HSL triplets, so that evaluated to
// `hsl(oklch(0.53 0.012 290))`, which is invalid CSS and painted the bar
// black. Left over from the pre-OKLCH token format.

const OTHER_COLOR = "var(--muted-foreground)";

function getPriorFilters(filters: ReportFilters): ReportFilters {
  const from = new Date(filters.fromDate ?? Date.now());
  const to = new Date(filters.toDate ?? Date.now());
  const diffMs = to.getTime() - from.getTime();
  const priorFrom = new Date(from.getTime() - diffMs);
  const priorTo = new Date(to.getTime() - diffMs);

  return {
    ...filters,
    fromDate: priorFrom.toISOString(),
    toDate: priorTo.toISOString(),
  };
}

export function SpendingByCategoryReport() {
  const t = useTranslations("reports.reports.spendingByCategory");
  const tCommon = useTranslations("reports.common");
  const tTrend = useTranslations("reports.trend");
  const tRoot = useTranslations();
  const { filters } = useReportFilters();
  const locale = useLocale();
  const { currencyKey } = useReportsCurrency();
  const shouldReduceMotion = useReducedMotion();

  const { data, isPending, error, refetch } = useSpendingByCategory(filters);
  const priorFilters = useMemo(() => getPriorFilters(filters), [filters]);
  const { data: priorData } = useSpendingByCategory(priorFilters);
  const { data: categoriesData } = useCategories();

  // The API sends `row.name` as the raw category name (the system-category
  // enum key, e.g. `CAFE_RESTAURANTS_BARS`, not a display string). Mirrors
  // BudgetVsActualReport's lookup so this chart shows the same names as the
  // category picker/budget pages instead of inventing a second mapping
  // (RAD-645) — keyed off `categoryKey` rather than guessing from the name
  // itself, so a user-defined category that happens to share a system
  // category's name is never mistranslated.
  const categoryByKey = useMemo(
    () =>
      new Map(
        getAllCategories(categoriesData?.categories ?? []).map((category) => [
          category.key.toString(),
          category,
        ]),
      ),
    [categoriesData],
  );

  const getCategoryDisplayName = useCallback(
    (row: SpendingByCategoryRow) => {
      const category = categoryByKey.get(row.categoryKey);
      return category?.isSystemCategory
        ? tRoot(getCategoryTranslationKey(category.name))
        : row.name;
    },
    [categoryByKey, tRoot],
  );

  const filename = useMemo(
    () => `reports/spending-by-category-${format(new Date(), "yyyy-MM-dd")}`,
    [],
  );

  const requestCsv = useMemo(
    () => async () => getSpendingByCategory({ ...filters, format: "csv" }),
    [filters],
  );

  const currentTotal = useMemo(
    () => data?.data.reduce((sum, row) => sum + row.totalAmount, 0) ?? 0,
    [data],
  );

  const priorTotal = useMemo(
    () => priorData?.data.reduce((sum, row) => sum + row.totalAmount, 0) ?? 0,
    [priorData],
  );

  const { delta, percent } = periodTrend(currentTotal, priorTotal);

  const chartData = useMemo(() => {
    if (!data?.data.length) return [];

    const sorted = [...data.data].sort((a, b) => b.totalAmount - a.totalAmount);
    const top = sorted.slice(0, TOP_CATEGORY_COUNT);
    const rest = sorted.slice(TOP_CATEGORY_COUNT);
    const otherTotal = rest.reduce((sum, row) => sum + row.totalAmount, 0);

    // The API hands back `#000000` for a category with no colour of its own —
    // "Uncategorized" is the common case — and Recharts paints exactly that, so
    // the largest bar on the chart rendered as a solid black slab. Treat the
    // placeholder (and a missing value) as "no colour" and fall back onto the
    // ramp by position, so every bar has a colour that belongs to the system.
    //
    const rows = top.map((row, index) => ({
      name: getCategoryDisplayName(row),
      amount: row.totalAmount,
      fill: resolveCategoryColor(row.color, index),
    }));

    if (otherTotal > 0) {
      rows.push({
        name: tCommon("other"),
        amount: otherTotal,
        fill: OTHER_COLOR,
      });
    }

    return rows;
  }, [data, tCommon, getCategoryDisplayName]);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      amount: {
        label: t("total"),
        color: "var(--chart-1)",
      },
    }),
    [t],
  );

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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground text-xs">{t("total")}</span>
            <ReportAmount
              value={currentTotal}
              currencyKey={currencyKey}
              className="font-medium"
            />
            <ReportTrendIndicator
              value={delta}
              percentage={percent === undefined ? undefined : Math.abs(percent)}
              direction="positive-is-down"
              label={tTrend("vsPriorPeriod")}
            />
          </div>
        </>
      }
      data-testid="spending-by-category-report"
    >
      {isPending ? (
        <ReportLoadingSkeleton kind="bar" />
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
          icon={PieChart}
          title={t("noData.title")}
          description={t("noData.description")}
        />
      ) : (
        <BarChartBase
          data={chartData}
          xKey="name"
          keys={["amount"]}
          config={chartConfig}
          layout="vertical"
          isAnimationActive={!shouldReduceMotion}
          getBarColor={(row) => row.fill}
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
