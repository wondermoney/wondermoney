"use client";

import { format } from "date-fns";
import { AlertCircle, PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { ExportCsvButton } from "@/components/reports/export/ExportCsvButton";
import { useReportFilters } from "@/components/reports/filters/useReportFilters";
import {
  ReportAmount,
  ReportCard,
  ReportEmptyState,
  ReportErrorState,
  ReportLoadingSkeleton,
} from "@/components/reports/primitives";
import { useReportsCurrency } from "@/components/reports/ReportsCurrencyContext";
import { Button } from "@/components/ui/button";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { Link } from "@/i18n/navigation";
import useAccounts from "@/lib/api/account/useAccounts";
import useCategories from "@/lib/api/category/useCategories";
import useBudgetVsActual, {
  getBudgetVsActual,
} from "@/lib/api/reports/budgetVsActual";
import type { BudgetVsActualRow } from "@/lib/api/reports/types";
import { cn } from "@/lib/utils";
import {
  getAllCategories,
  getCategoryTranslationKey,
} from "@/lib/utils/categories";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

function sortByPercentUsedDesc(a: BudgetVsActualRow, b: BudgetVsActualRow) {
  return b.percentUsed - a.percentUsed;
}

export function BudgetVsActualReport() {
  const t = useTranslations("reports.reports.budgetVsActual");
  const formatPercentage = useFormatPercentage();
  const tCommon = useTranslations("reports.common");
  const tRoot = useTranslations();
  const { filters } = useReportFilters();
  const { data, isLoading, error, refetch } = useBudgetVsActual(filters);
  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories();
  const { currencyKey } = useReportsCurrency();

  const hasAccounts = accountsData
    ? accountsData.accounts.length > 0
    : undefined;

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

  const getCategoryName = (row: BudgetVsActualRow) => {
    const category = categoryByKey.get(row.categoryKey);
    return category?.isSystemCategory
      ? tRoot(getCategoryTranslationKey(category.name))
      : row.name;
  };

  const rows = data?.data ?? [];
  const sortedRows = [...rows].sort(sortByPercentUsedDesc);
  const csvFilename = `reports/budget-vs-actual-${format(new Date(), "yyyy-MM-dd")}`;

  const requestCsv = useMemo(
    () => async () => getBudgetVsActual({ ...filters, format: "csv" }),
    [filters],
  );

  const headerActions = (
    <ExportCsvButton
      requestFn={requestCsv}
      filename={csvFilename}
      format="blob"
    />
  );

  if (isLoading) {
    return (
      <ReportCard
        title={t("title")}
        subtitle={t("subtitle")}
        data-testid="budget-vs-actual-report"
      >
        <ReportLoadingSkeleton kind="table" />
      </ReportCard>
    );
  }

  if (error) {
    return (
      <ReportCard
        title={t("title")}
        subtitle={t("subtitle")}
        data-testid="budget-vs-actual-report"
      >
        <ReportErrorState
          icon={AlertCircle}
          error={error}
          title={tCommon("error")}
          description={tCommon("errorDescription")}
          retryLabel={tCommon("retry")}
          onRetry={() => refetch()}
        />
      </ReportCard>
    );
  }

  if (rows.length === 0) {
    if (hasAccounts === false) {
      return (
        <ReportCard
          title={t("title")}
          subtitle={t("subtitle")}
          headerActions={headerActions}
          data-testid="budget-vs-actual-report"
        >
          <ReportEmptyState
            icon={PiggyBank}
            title={t("noBudget.title")}
            description={t("noBudget.description")}
            cta={
              <Button asChild variant="outline" size="sm">
                <Link href="/budgets">{t("setupBudget")}</Link>
              </Button>
            }
          />
        </ReportCard>
      );
    }

    return (
      <ReportCard
        title={t("title")}
        subtitle={t("subtitle")}
        headerActions={headerActions}
        data-testid="budget-vs-actual-report"
      >
        <ReportEmptyState
          icon={PiggyBank}
          title={t("noData.title")}
          description={t("noData.description")}
        />
      </ReportCard>
    );
  }

  return (
    <ReportCard
      title={t("title")}
      subtitle={t("subtitle")}
      headerActions={headerActions}
      data-testid="budget-vs-actual-report"
    >
      <div className="overflow-x-auto">
        <SimpleTable>
          <TableHeader>
            <TableRow>
              <TableHead>{t("category")}</TableHead>
              <TableHead className="text-right">{t("budgeted")}</TableHead>
              <TableHead className="text-right">{t("actual")}</TableHead>
              <TableHead className="text-right">{t("variance")}</TableHead>
              <TableHead className="text-right">{t("percentUsed")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => {
              const isOverBudget = row.percentUsed > 100;

              return (
                <TableRow
                  key={row.categoryKey}
                  className={cn(
                    "transition-colors",
                    isOverBudget &&
                      "border-l-destructive bg-destructive/5 border-l-4",
                  )}
                >
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <span>{getCategoryName(row)}</span>
                      {isOverBudget && (
                        <span className="text-destructive-text text-xs font-medium">
                          {t("overBudget")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ReportAmount
                      value={row.budgeted}
                      currencyKey={currencyKey}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ReportAmount
                      value={row.actual}
                      currencyKey={currencyKey}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ReportAmount
                      value={row.variance}
                      currencyKey={currencyKey}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatPercentage(row.percentUsed / 100, {
                      maximumFractionDigits: 0,
                    })}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </SimpleTable>
      </div>
    </ReportCard>
  );
}
