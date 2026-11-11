"use client";

import { format } from "date-fns";
import { AlertCircle, Scale } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { ExportCsvButton } from "@/components/reports/export/ExportCsvButton";
import { formatMonthLabel, monthKeyDateRange, monthKeyOf, MonthPicker, shiftMonthKey } from "@/components/reports/filters/MonthPicker";
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
import { BarChartBase } from "@/components/ui/charts";
import { Link } from "@/components/ui/Link";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import {
  reportTransactionScope,
  transactionReportScopeHref,
} from "@/lib/account/transaction-report-scope";
import useCategories from "@/lib/api/category/useCategories";
import useMonthComparison, {
  getMonthComparison,
} from "@/lib/api/reports/monthComparison";
import type { MonthComparisonCategoryRow } from "@/lib/api/reports/types";
import { cn } from "@/lib/utils";
import {
  getAllCategories,
  getCategoryTranslationKey,
} from "@/lib/utils/categories";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

/** The chart shows the largest changes; the table below lists every category. */
const TOP_CHANGE_COUNT = 12;

const UNCATEGORIZED_KEY = "-1";

export function MonthComparisonReport() {
  const t = useTranslations("reports.reports.monthComparison");
  const tCommon = useTranslations("reports.common");
  const tRoot = useTranslations();
  const { filters } = useReportFilters();
  const { currencyKey } = useReportsCurrency();
  const formatPercentage = useFormatPercentage();
  const formatAmountText = useFormatCurrency();
  const locale = useLocale();
  const shouldReduceMotion = useReducedMotion();

  // Defaults: this month against last month. The report owns its two months
  // rather than borrowing the page's date range, which it does not use.
  const [base, setBase] = useState(() => monthKeyOf(new Date()));
  const [compare, setCompare] = useState(() => shiftMonthKey(monthKeyOf(new Date()), -1));

  const { data, isPending, error, refetch } = useMonthComparison({
    ...filters,
    base,
    compare,
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
    (row: MonthComparisonCategoryRow) => {
      const category = categoryByKey.get(row.categoryKey);
      return category?.isSystemCategory
        ? tRoot(getCategoryTranslationKey(category.name))
        : row.name || tCommon("other");
    },
    [categoryByKey, tCommon, tRoot],
  );

  const filename = useMemo(
    () => `reports/month-comparison-${base}-vs-${compare}`,
    [base, compare],
  );

  const requestCsv = useMemo(
    () => async () =>
      getMonthComparison({ ...filters, base, compare, format: "csv" }),
    [base, compare, filters],
  );

  /**
   * The transactions behind one category's amount in one month, using the same
   * scope mapping as the other reports' totals. Uncategorized rows have no key
   * the transaction list accepts, so they are not linked.
   */
  const transactionsHref = useCallback(
    (monthKey: string, categoryKey: string) => {
      if (categoryKey === UNCATEGORIZED_KEY) return null;
      const scope = reportTransactionScope(
        {
          ...filters,
          ...monthKeyDateRange(monthKey),
          categoryKeys: [categoryKey],
        },
        "out",
      );
      return scope ? transactionReportScopeHref(scope) : null;
    },
    [filters],
  );

  const chartData = useMemo(() => {
    const rows = [...(data?.data.categories ?? [])]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, TOP_CHANGE_COUNT);
    return rows.map((row) => ({
      delta: row.delta,
      name: getCategoryName(row),
    }));
  }, [data, getCategoryName]);

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      delta: { label: t("change"), color: "var(--chart-1)" },
    }),
    [t],
  );

  const monthPickers = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <MonthPicker
        id="month-comparison-base"
        label={t("baseMonth")}
        onChange={setBase}
        value={base}
      />
      <MonthPicker
        id="month-comparison-compare"
        label={t("compareMonth")}
        onChange={setCompare}
        value={compare}
      />
    </div>
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
    const report = data?.data;
    if (!report) return null;

    const categories = report.categories;
    const totalRow = (
      label: string,
      baseValue: number,
      compareValue: number,
      render: (value: number) => ReactNode,
    ) => (
      <TableRow key={label}>
        <TableCell className="font-medium">{label}</TableCell>
        <TableCell className="text-right font-mono">{render(baseValue)}</TableCell>
        <TableCell className="text-right font-mono">{render(compareValue)}</TableCell>
        <TableCell className="text-right font-mono">
          {render(baseValue - compareValue)}
        </TableCell>
      </TableRow>
    );

    return (
      <div className="flex flex-col gap-8">
        <SimpleTable>
          <TableHeader>
            <TableRow>
              <TableHead>{t("metric")}</TableHead>
              <TableHead className="text-right">
                {formatMonthLabel(base, locale)}
              </TableHead>
              <TableHead className="text-right">
                {formatMonthLabel(compare, locale)}
              </TableHead>
              <TableHead className="text-right">{t("change")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totalRow(t("income"), report.base.income, report.compare.income, (value) => (
              <ReportAmount value={value} currencyKey={currencyKey} />
            ))}
            {totalRow(t("expenses"), report.base.expenses, report.compare.expenses, (value) => (
              <ReportAmount value={value} currencyKey={currencyKey} />
            ))}
            {totalRow(t("net"), report.base.net, report.compare.net, (value) => (
              <ReportAmount value={value} currencyKey={currencyKey} />
            ))}
            <TableRow>
              <TableCell className="font-medium">{t("savingsRate")}</TableCell>
              <TableCell className="text-right font-mono">
                {formatRate(report.base.savingsRate, formatPercentage, tCommon("currencyUnknown"))}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatRate(report.compare.savingsRate, formatPercentage, tCommon("currencyUnknown"))}
              </TableCell>
              <TableCell className="text-right font-mono">
                {report.base.savingsRate === null || report.compare.savingsRate === null
                  ? tCommon("currencyUnknown")
                  : formatPercentage(report.base.savingsRate - report.compare.savingsRate, { maximumFractionDigits: 1 })}
              </TableCell>
            </TableRow>
          </TableBody>
        </SimpleTable>

        {categories.length === 0 ? (
          <ReportEmptyState
            icon={Scale}
            title={t("noData.title")}
            description={t("noData.description")}
          />
        ) : (
          <>
            <div>
              <BarChartBase
                data={chartData}
                xKey="name"
                keys={["delta"]}
                config={chartConfig}
                layout="vertical"
                isAnimationActive={!shouldReduceMotion}
                getBarColor={(row) =>
                  (row as { delta: number }).delta > 0
                    ? "var(--destructive-text)"
                    : (row as { delta: number }).delta < 0
                      ? "var(--success-text)"
                      : "var(--muted-foreground)"
                }
                xFormatter={(value) => String(value)}
                yFormatter={(value) =>
                  formatAmountText(Number(value), currencyKey, {
                    notation: "compact",
                    maximumFractionDigits: 0,
                  })
                }
                tooltipValueFormatter={(value) => (
                  <ReportAmount value={Number(value)} currencyKey={currencyKey} />
                )}
              />
              {categories.length > TOP_CHANGE_COUNT ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  {t("largestChanges", { count: TOP_CHANGE_COUNT })}
                </p>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <SimpleTable>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("category")}</TableHead>
                    <TableHead className="text-right">
                      {formatMonthLabel(base, locale)}
                    </TableHead>
                    <TableHead className="text-right">
                      {formatMonthLabel(compare, locale)}
                    </TableHead>
                    <TableHead className="text-right">{t("change")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((row) => {
                    const baseHref = transactionsHref(base, row.categoryKey);
                    const compareHref = transactionsHref(compare, row.categoryKey);
                    return (
                      <TableRow key={row.categoryKey}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="inline-block size-2 rounded-full"
                              style={{ backgroundColor: row.color }}
                              aria-hidden="true"
                            />
                            <span>{getCategoryName(row)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          <CategoryAmount
                            currencyKey={currencyKey}
                            href={baseHref}
                            monthLabel={formatMonthLabel(base, locale)}
                            value={row.base}
                            viewLabel={t("viewTransactions")}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          <CategoryAmount
                            currencyKey={currencyKey}
                            href={compareHref}
                            monthLabel={formatMonthLabel(compare, locale)}
                            value={row.compare}
                            viewLabel={t("viewTransactions")}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          <span
                            className={cn(
                              row.delta > 0 && "text-destructive-text",
                              row.delta < 0 && "text-success-text",
                            )}
                          >
                            {row.delta > 0 ? "+" : ""}
                            <ReportAmount value={row.delta} currencyKey={currencyKey} />
                            {row.deltaPct === null ? null : (
                              <span className="text-muted-foreground ml-1 text-xs">
                                {formatPercentage(row.deltaPct / 100, {
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </SimpleTable>
            </div>
          </>
        )}
      </div>
    );
  })();

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
      data-testid="month-comparison-report"
    >
      <div className="flex flex-col gap-6">
        {monthPickers}
        {body}
        {!isPending && !error ? (
          <UnconvertedAmountsNotice
            completeness={data?.completeness}
            className="max-w-prose"
          />
        ) : null}
      </div>
    </ReportCard>
  );
}

function formatRate(
  value: number | null,
  formatPercentage: (value: number, options?: Intl.NumberFormatOptions) => string,
  missing: string,
): string {
  return value === null
    ? missing
    : formatPercentage(value, { maximumFractionDigits: 0 });
}

function CategoryAmount({
  currencyKey,
  href,
  monthLabel,
  value,
  viewLabel,
}: {
  currencyKey?: string;
  href: string | null;
  monthLabel: string;
  value: number;
  viewLabel: string;
}) {
  if (!href) return <ReportAmount value={value} currencyKey={currencyKey} />;
  return (
    <Link href={href} className="underline-offset-4 hover:underline">
      <ReportAmount value={value} currencyKey={currencyKey} />
      <span className="sr-only">
        {viewLabel} — {monthLabel}
      </span>
    </Link>
  );
}
