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
import type {
  SankeyNode,
  SankeyNodeIcon,
} from "@/components/reports/sankey/sankey-layout";
import { SankeyChart } from "@/components/reports/sankey/SankeyChart";
import useAccounts, { type Account } from "@/lib/api/account/useAccounts";
import type { ChildCategory } from "@/lib/api/category/useCategories";
import useConfigs from "@/lib/api/configs/useConfigs";
import useSankey, { getSankey } from "@/lib/api/reports/sankey";
import type { SankeyNode as SankeyApiNode } from "@/lib/api/reports/types";
import { getCategoryDisplayName } from "@/lib/utils/categories";

// The API builds node ids from the row behind each node: `income-<categoryKey>`,
// `expense-<categoryKey>`, `account-<accountKey>`. Overflow buckets
// (`__other_income` and the like) match none of these and get no icon.
const NODE_ID_PATTERN = /^(income|expense|account)-(.+)$/;
const UNCATEGORIZED_KEY = "uncategorized";

function nodeIcon(
  node: SankeyApiNode,
  categories: Map<string, Pick<ChildCategory, "icon" | "name">>,
  accounts: Map<string, Account>,
): SankeyNodeIcon | undefined {
  const match = NODE_ID_PATTERN.exec(node.id);
  if (!match) return undefined;
  const key = match[2];

  if (node.kind === "account") {
    const logoUrl =
      accounts.get(key)?.accountFinancialInstitutionKey?.logoUrl ?? null;
    return logoUrl ? { type: "logo", url: logoUrl } : { type: "wallet" };
  }
  if (key === UNCATEGORIZED_KEY) return { type: "category", icon: "question" };
  const category = categories.get(key);
  if (!category) return undefined;
  return { type: "category", icon: category.icon, category: category.name };
}

export function SankeyReport() {
  const t = useTranslations("reports.reports.sankey");
  const tCommon = useTranslations("reports.common");
  const tCategories = useTranslations();
  const { filters } = useReportFilters();
  const locale = useLocale();
  const { currencyKey } = useReportsCurrency();
  const { data, isPending, error, refetch } = useSankey(filters);
  // Node icons join on data the app already holds: categories from configs
  // (system and the person's own), accounts for their bank's logo.
  const { data: configs } = useConfigs();
  const { data: accountsData } = useAccounts();

  const categoriesByKey = useMemo(() => {
    const map = new Map<string, Pick<ChildCategory, "icon" | "name">>();
    for (const category of configs?.categories ?? []) {
      map.set(String(category.categoryKey), category);
      for (const child of category.childCategory ?? []) {
        // A subcategory without an icon of its own borrows its parent's.
        map.set(String(child.categoryKey), {
          name: child.name,
          icon: child.icon ?? category.icon,
        });
      }
    }
    return map;
  }, [configs]);

  const accountsByKey = useMemo(
    () =>
      new Map(
        (accountsData?.accounts ?? []).map((account) => [
          String(account.accountKey),
          account,
        ]),
      ),
    [accountsData],
  );

  // The API sends income/expense node labels as the raw category name
  // (`CAFE_RESTAURANTS_BARS` for system categories) — the same shape
  // `CategorySelect` translates for the category picker. Account nodes carry
  // real account names, not category keys, so they pass through untouched.
  const localizedData = useMemo(() => {
    if (!data?.data) return undefined;
    return {
      ...data.data,
      nodes: data.data.nodes.map((node): SankeyNode => ({
        ...node,
        label:
          node.kind === "account"
            ? node.label
            : getCategoryDisplayName(tCategories, node.label),
        icon: nodeIcon(node, categoriesByKey, accountsByKey),
      })),
    };
  }, [data, tCategories, categoriesByKey, accountsByKey]);

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
