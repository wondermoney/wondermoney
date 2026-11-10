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

import {
  portfolioPerformanceFilters,
  sortByAbsoluteChangeDesc,
  totalPortfolioPerformance,
} from "./portfolio-performance";

/** A value the API could not know (no snapshot) reads as an em dash, never 0. */
function OptionalAmount({
  value,
  currencyKey,
  unknownLabel,
}: {
  value: number | null;
  currencyKey: string;
  unknownLabel: string;
}) {
  if (value === null) {
    return (
      <span className="text-muted-foreground" aria-label={unknownLabel}>
        —
      </span>
    );
  }
  return <ReportAmount value={value} currencyKey={currencyKey} />;
}

function ChangeCell({
  change,
  changePercent,
  currencyKey,
  unknownLabel,
}: {
  change: number | null;
  changePercent: number | null;
  currencyKey: string;
  unknownLabel: string;
}) {
  if (change === null) {
    return (
      <OptionalAmount
        value={null}
        currencyKey={currencyKey}
        unknownLabel={unknownLabel}
      />
    );
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-mono whitespace-nowrap tabular-nums">
        {change > 0 ? "+" : ""}
        <ReportAmount value={change} currencyKey={currencyKey} />
      </span>
      <ReportTrendIndicator
        value={change}
        percentage={changePercent ?? undefined}
        className="text-xs"
      />
    </div>
  );
}

export function PortfolioPerformanceReport() {
  const t = useTranslations("reports.reports.portfolioPerformance");
  const tCommon = useTranslations("reports.common");
  const { filters: reportFilters } = useReportFilters();
  const filters = useMemo(
    () => portfolioPerformanceFilters(reportFilters),
    [reportFilters],
  );
  const { data, isLoading, error, refetch } = usePortfolioPerformance(filters);
  const { currencyKey } = useReportsCurrency();

  const rows = data?.data ?? [];
  const sortedRows = [...rows].sort(sortByAbsoluteChangeDesc);
  const totals = totalPortfolioPerformance(rows);
  const unknownLabel = t("unknownValue");
  // Contributions and dividends are unknown only when a trade or payout has no exchange rate.
  const noRateLabel = t("noExchangeRate");
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
              <TableHead>{t("portfolio")}</TableHead>
              <TableHead className="text-right">{t("startValue")}</TableHead>
              <TableHead className="text-right">
                {t("netContributions")}
              </TableHead>
              <TableHead className="text-right">{t("change")}</TableHead>
              <TableHead className="text-right">{t("dividends")}</TableHead>
              <TableHead className="text-right">{t("endValue")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.portfolioKey}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={row.startValue}
                    currencyKey={currencyKey}
                    unknownLabel={unknownLabel}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={row.netContributions}
                    currencyKey={currencyKey}
                    unknownLabel={noRateLabel}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <ChangeCell
                    change={row.change}
                    changePercent={row.changePercent}
                    currencyKey={currencyKey}
                    unknownLabel={unknownLabel}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={row.dividends}
                    currencyKey={currencyKey}
                    unknownLabel={noRateLabel}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={row.endValue}
                    currencyKey={currencyKey}
                    unknownLabel={unknownLabel}
                  />
                </TableCell>
              </TableRow>
            ))}
            {rows.length > 1 && (
              <TableRow className="font-medium">
                <TableCell>{t("total")}</TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={totals.startValue}
                    currencyKey={currencyKey}
                    unknownLabel={unknownLabel}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={totals.netContributions}
                    currencyKey={currencyKey}
                    unknownLabel={noRateLabel}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <ChangeCell
                    change={totals.change}
                    changePercent={totals.changePercent}
                    currencyKey={currencyKey}
                    unknownLabel={unknownLabel}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={totals.dividends}
                    currencyKey={currencyKey}
                    unknownLabel={noRateLabel}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  <OptionalAmount
                    value={totals.endValue}
                    currencyKey={currencyKey}
                    unknownLabel={unknownLabel}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </SimpleTable>
      </div>
    </ReportCard>
  );
}
