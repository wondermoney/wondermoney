"use client";

import { format } from "date-fns";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Minus,
  TrendingUp,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

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

/**
 * A period return in percent. The sign and the chevron say which way it went,
 * the colour only whether that is good; a yearly rate says so underneath.
 */
function ReturnCell({
  value,
  annualized = false,
  unknownLabel,
}: {
  value: number | null;
  annualized?: boolean;
  unknownLabel: string;
}) {
  const t = useTranslations("reports.reports.portfolioPerformance");
  const formatPercentage = useFormatPercentage();
  if (value === null) {
    return (
      <span className="text-muted-foreground" aria-label={unknownLabel}>
        —
      </span>
    );
  }
  const Icon = value === 0 ? Minus : value > 0 ? ChevronUp : ChevronDown;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 font-mono whitespace-nowrap tabular-nums",
          value === 0
            ? "text-muted-foreground"
            : value > 0
              ? "text-success-text"
              : "text-destructive-text",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {formatPercentage(value / 100, {
          maximumFractionDigits: 2,
          signDisplay: "exceptZero",
        })}
      </span>
      {annualized ? (
        <span className="text-muted-foreground text-xs">{t("perYear")}</span>
      ) : null}
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
  const returnUnavailableLabel = t("returnUnavailable");
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
              <TableHead className="text-right">{t("timeWeighted")}</TableHead>
              <TableHead className="text-right">{t("moneyWeighted")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow key={row.portfolioKey}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span>{row.name}</span>
                    {row.missingSnapshotDates.length > 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {t("missingSnapshots", {
                          count: row.missingSnapshotDates.length,
                        })}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
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
                <TableCell className="text-right">
                  <ReturnCell
                    value={row.timeWeightedReturn}
                    unknownLabel={returnUnavailableLabel}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <ReturnCell
                    value={row.moneyWeightedReturn}
                    annualized={row.moneyWeightedReturnAnnualized}
                    unknownLabel={returnUnavailableLabel}
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
                {/* A household rate needs every portfolio's cash flows, not
                    their rates: averaging rows would state a figure nobody earned. */}
                <TableCell className="text-right">
                  <ReturnCell value={null} unknownLabel={t("notCombined")} />
                </TableCell>
                <TableCell className="text-right">
                  <ReturnCell value={null} unknownLabel={t("notCombined")} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </SimpleTable>
      </div>
      <dl className="text-muted-foreground mt-4 flex flex-col gap-1 text-xs">
        <div>
          <dt className="text-foreground inline font-medium">
            {t("timeWeighted")}:
          </dt>{" "}
          <dd className="inline">{t("timeWeightedDescription")}</dd>
        </div>
        <div>
          <dt className="text-foreground inline font-medium">
            {t("moneyWeighted")}:
          </dt>{" "}
          <dd className="inline">{t("moneyWeightedDescription")}</dd>
        </div>
      </dl>
    </ReportCard>
  );
}
