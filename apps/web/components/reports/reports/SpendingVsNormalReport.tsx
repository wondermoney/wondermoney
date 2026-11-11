"use client";

import { AlertCircle, LayoutGrid } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { formatMonthLabel, monthKeyDateRange, monthKeyOf, MonthPicker } from "@/components/reports/filters/MonthPicker";
import { useReportFilters } from "@/components/reports/filters/useReportFilters";
import {
  ReportAmount,
  ReportCard,
  ReportEmptyState,
  ReportErrorState,
  ReportLoadingSkeleton,
} from "@/components/reports/primitives";
import { useReportsCurrency } from "@/components/reports/ReportsCurrencyContext";
import type { ChartConfig } from "@/components/ui/chart";
import { TreemapChartBase, type TreemapTileDatum } from "@/components/ui/charts";
import { Link } from "@/components/ui/Link";
import {
  SimpleTable,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import { useRouter } from "@/i18n/navigation";
import {
  reportTransactionScope,
  transactionReportScopeHref,
} from "@/lib/account/transaction-report-scope";
import useCategories from "@/lib/api/category/useCategories";
import useSpendingVsNormal from "@/lib/api/reports/spendingVsNormal";
import type { SpendingVsNormalRow } from "@/lib/api/reports/types";
import {
  spendingVsNormalChange,
  spendingVsNormalFill,
  spendingVsNormalTextClass,
  spendingVsNormalTone,
} from "@/lib/reports/spending-vs-normal";
import { cn } from "@/lib/utils";
import {
  getAllCategories,
  getCategoryTranslationKey,
} from "@/lib/utils/categories";
import { useFormatCurrencyForScreenReader } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface TreemapTile extends TreemapTileDatum {
  categoryKey: string;
}

/**
 * Spending vs normal: where this month's money went, and which categories ran above or below
 * their own three-month normal.
 *
 * The treemap shows the top-level categories (the unit the home insight reports); the table below
 * breaks each one into its subcategories and is the accessible equivalent — every tile's spend,
 * normal and change is a row there, and every row links to the transactions behind it. A category
 * with no usable baseline is neutral in both places, never "above normal".
 */
export function SpendingVsNormalReport() {
  const t = useTranslations("reports.reports.spendingVsNormal");
  const tCommon = useTranslations("reports.common");
  const tRoot = useTranslations();
  const { filters } = useReportFilters();
  const { currencyKey } = useReportsCurrency();
  const formatPercentage = useFormatPercentage();
  const formatAmountForScreenReader = useFormatCurrencyForScreenReader();
  const locale = useLocale();
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();

  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const { data, isPending, error, refetch } = useSpendingVsNormal({
    ...filters,
    month,
  });
  const { data: categoriesData } = useCategories();

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

  const getCategoryName = useCallback(
    (row: SpendingVsNormalRow) => {
      const category = categoryByKey.get(row.categoryKey);
      return category?.isSystemCategory
        ? tRoot(getCategoryTranslationKey(category.name))
        : row.name;
    },
    [categoryByKey, tRoot],
  );

  const rows = useMemo(() => data?.data.rows ?? [], [data]);
  const topLevelRows = useMemo(
    () => rows.filter((row) => row.parentKey === null),
    [rows],
  );
  const activeRow = useMemo(
    () => rows.find((row) => row.categoryKey === activeKey) ?? null,
    [activeKey, rows],
  );
  // A top-level row's total is the sum of its subcategories, and transactions are assigned to
  // those, never to the parent. Its link must therefore ask for the children's keys too.
  const childKeysByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (row.parentKey === null) continue;
      const keys = map.get(row.parentKey) ?? [];
      keys.push(row.categoryKey);
      map.set(row.parentKey, keys);
    }
    return map;
  }, [rows]);

  const changeText = useCallback(
    (row: SpendingVsNormalRow) => {
      const change = spendingVsNormalChange(row);
      if (change === null) return null;
      return `${change > 0 ? "+" : ""}${formatPercentage(change / 100, {
        maximumFractionDigits: 0,
      })}`;
    },
    [formatPercentage],
  );

  const changeLabel = useCallback(
    (row: SpendingVsNormalRow) => {
      const change = spendingVsNormalChange(row);
      // A normal below the insight's materiality floor is present but cannot carry a percentage.
      if (change === null) {
        return row.normal === null ? t("noBaseline") : t("baselineTooSmall");
      }
      const direction =
        change > 0
          ? t("aboveNormal")
          : change < 0
            ? t("belowNormal")
            : t("nearNormal");
      return `${changeText(row)} ${direction}`;
    },
    [changeText, t],
  );

  const transactionsHref = useCallback(
    (categoryKey: string) => {
      const scope = reportTransactionScope(
        {
          ...filters,
          ...monthKeyDateRange(month),
          // The report counts a pending row as committed and never counts a transfer, exactly as
          // the insight does; the list must count the same rows. A top-level row's money sits in
          // its subcategories, so its link asks for their keys as well.
          categoryKeys: [
            categoryKey,
            ...(childKeysByParent.get(categoryKey) ?? []),
          ],
          includePending: true,
          includeTransfers: false,
        },
        "out",
      );
      return scope ? transactionReportScopeHref(scope) : null;
    },
    [childKeysByParent, filters, month],
  );

  const tiles = useMemo<TreemapTile[]>(
    () =>
      topLevelRows.map((row) => {
        const tone = spendingVsNormalTone(row.ratio);
        const name = getCategoryName(row);
        return {
          ariaLabel: `${name}. ${t("spent")} ${formatAmountForScreenReader(
            row.total,
            currencyKey,
          )}. ${t("change")} ${changeLabel(row)}`,
          categoryKey: row.categoryKey,
          dashed: tone === "none",
          detail: changeText(row) ?? "—",
          fill: spendingVsNormalFill(tone),
          name,
          textClassName: spendingVsNormalTextClass(tone),
          value: row.total,
        };
      }),
    [
      changeLabel,
      changeText,
      currencyKey,
      formatAmountForScreenReader,
      getCategoryName,
      t,
      topLevelRows,
    ],
  );

  const chartConfig = useMemo<ChartConfig>(
    () => ({ spent: { label: t("spent"), color: "var(--chart-1)" } }),
    [t],
  );

  const body = (() => {
    if (isPending) return <ReportLoadingSkeleton kind="table" />;
    if (error) {
      return (
        <ReportErrorState
          icon={AlertCircle}
          error={error}
          title={tCommon("error")}
          description={tCommon("errorDescription")}
          retryLabel={tCommon("retry")}
          onRetry={() => void refetch()}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <ReportEmptyState
          icon={LayoutGrid}
          title={t("noData.title")}
          description={t("noData.description")}
        />
      );
    }

    return (
      <div className="flex flex-col gap-6">
        <TreemapChartBase
          config={chartConfig}
          data={tiles}
          isAnimationActive={!shouldReduceMotion}
          onActivate={(tile) => {
            const href = transactionsHref(tile.categoryKey);
            if (href) router.push(href);
          }}
          onHoverChange={(tile) => setActiveKey(tile?.categoryKey ?? null)}
        />

        {/* The tile the reader is pointing at or tabbing through, in words. */}
        <div className="bg-muted/50 flex min-h-11 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          {activeRow ? (
            <>
              <span className="font-medium">{getCategoryName(activeRow)}</span>
              <Detail label={t("spent")}>
                <ReportAmount
                  currencyKey={currencyKey}
                  value={activeRow.total}
                />
              </Detail>
              <Detail label={t("normal")}>
                {activeRow.normal === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <ReportAmount
                    currencyKey={currencyKey}
                    value={activeRow.normal}
                  />
                )}
              </Detail>
              <Detail label={t("change")}>
                <ChangeValue
                  change={spendingVsNormalChange(activeRow)}
                  formatPercentage={formatPercentage}
                  label={changeLabel(activeRow)}
                  tone={spendingVsNormalTone(activeRow.ratio)}
                />
              </Detail>
            </>
          ) : (
            <span className="text-muted-foreground">{t("hoverHint")}</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <SimpleTable>
            <TableCaption className="sr-only">
              {t("tableCaption", { month: formatMonthLabel(month, locale) })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("category")}</TableHead>
                <TableHead className="text-right">{t("spent")}</TableHead>
                <TableHead className="text-right">{t("normal")}</TableHead>
                <TableHead className="text-right">{t("change")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const href = transactionsHref(row.categoryKey);
                const name = getCategoryName(row);
                const parent = row.parentKey
                  ? rows.find(
                      (candidate) => candidate.categoryKey === row.parentKey,
                    )
                  : null;
                return (
                  <TableRow key={row.categoryKey}>
                    <TableCell
                      className={cn(
                        row.parentKey === null ? "font-medium" : "pl-6",
                      )}
                    >
                      {parent ? (
                        <span className="sr-only">
                          {t("subcategoryOf", {
                            parent: getCategoryName(parent),
                          })}
                        </span>
                      ) : null}
                      {name}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {href ? (
                        <Link
                          className="underline-offset-4 hover:underline"
                          href={href}
                        >
                          <ReportAmount
                            currencyKey={currencyKey}
                            value={row.total}
                          />
                          <span className="sr-only">
                            {t("viewTransactions")} — {name}
                          </span>
                        </Link>
                      ) : (
                        <ReportAmount
                          currencyKey={currencyKey}
                          value={row.total}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.normal === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ReportAmount
                          currencyKey={currencyKey}
                          value={row.normal}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <ChangeValue
                        change={spendingVsNormalChange(row)}
                        formatPercentage={formatPercentage}
                        label={changeLabel(row)}
                        tone={spendingVsNormalTone(row.ratio)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </SimpleTable>
        </div>
      </div>
    );
  })();

  return (
    <ReportCard
      data-testid="spending-vs-normal-report"
      subtitle={t("subtitle")}
      title={t("title")}
    >
      <div className="flex flex-col gap-6">
        <MonthPicker
          className="max-w-xs"
          id="spending-vs-normal-month"
          label={t("month")}
          onChange={setMonth}
          value={month}
        />
        {body}
        {!isPending && !error ? (
          <UnconvertedAmountsNotice
            className="max-w-prose"
            completeness={data?.completeness}
          />
        ) : null}
      </div>
    </ReportCard>
  );
}

function Detail({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono">{children}</span>
    </span>
  );
}

function ChangeValue({
  change,
  formatPercentage,
  label,
  tone,
}: {
  change: number | null;
  formatPercentage: (
    value: number,
    options?: Intl.NumberFormatOptions,
  ) => string;
  /** The change in words, for the screen reader: "above normal", "no baseline", ... */
  label: string;
  tone: ReturnType<typeof spendingVsNormalTone>;
}) {
  if (change === null) {
    return (
      <span className="text-muted-foreground">
        —<span className="sr-only"> {label}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        tone === "above" || tone === "wellAbove"
          ? "text-destructive-text"
          : tone === "below"
            ? "text-success-text"
            : "text-foreground",
      )}
    >
      {change > 0 ? "+" : ""}
      {formatPercentage(change / 100, { maximumFractionDigits: 0 })}
      <span className="sr-only"> {label}</span>
    </span>
  );
}
