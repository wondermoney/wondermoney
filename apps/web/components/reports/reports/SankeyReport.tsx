"use client";

import { format } from "date-fns";
import { AlertCircle, ArrowLeftRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { ExportCsvButton } from "@/components/reports/export/ExportCsvButton";
import { useReportFilters } from "@/components/reports/filters/useReportFilters";
import {
  ReportCard,
  ReportEmptyState,
  ReportErrorState,
  ReportLoadingSkeleton,
} from "@/components/reports/primitives";
import { useReportsCurrency } from "@/components/reports/ReportsCurrencyContext";
import { SankeyChart } from "@/components/reports/sankey/SankeyChart";
import useSankey, { getSankey } from "@/lib/api/reports/sankey";
import { getCategoryDisplayName } from "@/lib/utils/categories";

export function SankeyReport() {
  const t = useTranslations("reports.reports.sankey");
  const tCommon = useTranslations("reports.common");
  const tCategories = useTranslations();
  const { filters } = useReportFilters();
  const locale = useLocale();
  const { currencyKey } = useReportsCurrency();
  const { data, isPending, error, refetch } = useSankey(filters);

  // The API sends income/expense node labels as the raw category name
  // (`CAFE_RESTAURANTS_BARS` for system categories) — the same shape
  // `CategorySelect` translates for the category picker. Account nodes carry
  // real account names, not category keys, so they pass through untouched
  // (RAD-645).
  const localizedData = useMemo(() => {
    if (!data?.data) return undefined;
    return {
      ...data.data,
      nodes: data.data.nodes.map((node) =>
        node.kind === "account"
          ? node
          : { ...node, label: getCategoryDisplayName(tCategories, node.label) },
      ),
    };
  }, [data, tCategories]);

  const filename = useMemo(
    () => `reports/sankey-${format(new Date(), "yyyy-MM-dd")}`,
    [],
  );

  // The chart height was a flat 420px regardless of node count. With d3-sankey's
  // fixed nodePadding (16px), a wide account fills its rows fine, but the
  // expense/category column — often a dozen-plus categories in one account —
  // got squeezed into slivers a few px tall, and their labels collided with
  // neighbouring nodes and links. Grow the chart with the busiest column
  // instead of clipping it.
  const chartHeight = useMemo(() => {
    const expenseNodeCount =
      localizedData?.nodes.filter((node) => node.kind === "expense").length ??
      0;
    return Math.max(420, expenseNodeCount * 48);
  }, [localizedData]);

  const requestCsv = useMemo(
    () => async () => getSankey({ ...filters, format: "csv" }),
    [filters],
  );

  return (
    <ReportCard
      title={t("title")}
      subtitle={t("subtitle")}
      headerActions={
        <ExportCsvButton
          requestFn={requestCsv}
          filename={filename}
          format="blob"
        />
      }
      data-testid="sankey-report"
    >
      {isPending ? (
        <ReportLoadingSkeleton kind="sankey" />
      ) : error ? (
        <ReportErrorState
          icon={AlertCircle}
          error={error}
          title={tCommon("error")}
          description={tCommon("errorDescription")}
          retryLabel={tCommon("retry")}
          onRetry={() => void refetch()}
        />
      ) : !localizedData || localizedData.links.length === 0 ? (
        <ReportEmptyState
          icon={ArrowLeftRight}
          title={t("noData.title")}
          description={t("noData.description")}
        />
      ) : (
        <SankeyChart
          data={localizedData}
          locale={locale}
          currencyKey={currencyKey}
          height={chartHeight}
        />
      )}
    </ReportCard>
  );
}
