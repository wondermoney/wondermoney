"use client";

import { format } from "date-fns";
import { AlertCircle, TrendingUp } from "lucide-react";
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
  ReportTrendIndicator,
} from "@/components/reports/primitives";
import { useReportsCurrency } from "@/components/reports/ReportsCurrencyContext";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import usePortfolioPerformance, {
  getPortfolioPerformance,
} from "@/lib/api/reports/portfolioPerformance";
import type { PortfolioPerformanceRow } from "@/lib/api/reports/types";
import { cn } from "@/lib/utils";

function sortByAbsoluteReturnDesc(
  a: PortfolioPerformanceRow,
  b: PortfolioPerformanceRow,
) {
  return Math.abs(b.return) - Math.abs(a.return);
}

function formatSignedCurrency(
  value: number,
  currencyKey: string,
  className?: string,
) {
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cn("font-mono whitespace-nowrap tabular-nums", className)}>
      {sign}
      <ReportAmount value={value} currencyKey={currencyKey} />
    </span>
  );
}

export function PortfolioPerformanceReport() {
  const t = useTranslations("reports.reports.portfolioPerformance");
  const tCommon = useTranslations("reports.common");
  const { filters } = useReportFilters();
  const { data, isLoading, error, refetch } = usePortfolioPerformance(filters);
  const { currencyKey } = useReportsCurrency();

  const rows = data?.data ?? [];
  const sortedRows = [...rows].sort(sortByAbsoluteReturnDesc);
  const aggregateReturn = rows.reduce((sum, row) => sum + row.return, 0);
  const csvFilename = `reports/portfolio-performance-${format(new Date(), "yyyy-MM-dd")}`;

  const requestCsv = useMemo(
    () => async () => getPortfolioPerformance({ ...filters, format: "csv" }),
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
        data-testid="portfolio-performance-report"
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
        data-testid="portfolio-performance-report"
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
    return (
      <ReportCard
        title={t("title")}
        subtitle={t("subtitle")}
        headerActions={headerActions}
        data-testid="portfolio-performance-report"
      >
        <ReportEmptyState
          icon={TrendingUp}
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
      data-testid="portfolio-performance-report"
    >
      <div className="overflow-x-auto">
        <SimpleTable>
          <TableHeader>
            <TableRow>
              <TableHead>{t("account")}</TableHead>
              <TableHead className="text-right">{t("startBalance")}</TableHead>
              <TableHead className="text-right">{t("contributions")}</TableHead>
              <TableHead className="text-right">{t("return")}</TableHead>
              <TableHead className="text-right">{t("endBalance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.accountKey}>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{row.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {row.currency}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  <ReportAmount
                    value={row.startBalance}
                    currencyKey={currencyKey}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <ReportAmount
                    value={row.contributions}
                    currencyKey={currencyKey}
                  />
                </TableCell>
                <TableCell className="text-right">
                  {formatSignedCurrency(row.return, currencyKey)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  <ReportAmount
                    value={row.endBalance}
                    currencyKey={currencyKey}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SimpleTable>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-muted-foreground max-w-xl text-xs">
          {t("startCaveat")}
        </p>
        <ReportTrendIndicator value={aggregateReturn} />
      </div>
    </ReportCard>
  );
}
