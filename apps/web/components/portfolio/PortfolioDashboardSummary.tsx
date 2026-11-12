"use client";

import { CalendarX2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import { DataProvenance } from "@/components/ui/DataProvenance";
import Stats, { type StatsItem } from "@/components/ui/Stats";
import type { DashboardSummary } from "@/lib/api/portfolio/usePortfolioDashboard";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

import { FeeConversionNotice } from "./FeeConversionNotice";

interface PortfolioDashboardSummaryProps {
  summary: DashboardSummary;
  isAggregate?: boolean;
}

function changeTypeOf(value: number | null | undefined) {
  if (value == null || value === 0) return null;
  return value > 0 ? "increase" : "decrease";
}

/**
 * Days in the period with no snapshot had the day before's value carried
 * over, which flattens any move on those days. Said quietly under the figures
 * it affects; the words carry it, there is no status colour.
 */
function MissingSnapshotsNote({ count }: { count: number }) {
  const t = useTranslations();
  return (
    <p
      role="note"
      className="text-muted-foreground flex items-start gap-1.5 text-xs leading-5"
    >
      <CalendarX2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{t("period-returns-missing-snapshots", { count })}</span>
    </p>
  );
}

const PortfolioDashboardSummary: React.FC<PortfolioDashboardSummaryProps> = ({
  summary,
  isAggregate = false,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();

  const gainLossChangeType =
    summary.totalGainLoss === 0
      ? null
      : summary.totalGainLoss > 0
        ? "increase"
        : "decrease";

  const isPeriodReturnUnavailable = summary.periodReturn == null;
  const hasHoldings = summary.assetCount > 0;

  const periodReturnUnavailableValueLabel = isPeriodReturnUnavailable
    ? hasHoldings
      ? t("portfolio-metric-unavailable")
      : t("no-holdings")
    : undefined;

  const periodReturnHelperText = isPeriodReturnUnavailable
    ? hasHoldings
      ? t("period-return-unavailable")
      : t("portfolio-empty-state-description")
    : undefined;

  const periodReturnChangeType = isPeriodReturnUnavailable
    ? null
    : (summary.periodReturn as number) === 0
      ? null
      : (summary.periodReturn as number) > 0
        ? "increase"
        : "decrease";

  const percentFormat = {
    style: "percent",
    maximumFractionDigits: 2,
    signDisplay: "always",
  } as const;

  const periodReturns = summary.periodReturns;
  const missingSnapshotCount = periodReturns?.missingSnapshotDates.length ?? 0;

  // Null means the period has too little to measure; it reads like an
  // unavailable period return, with the one-line definition kept underneath.
  const returnStat = (
    name: string,
    value: number | null,
    description: string,
  ): StatsItem => ({
    name,
    value: value == null ? null : value / 100,
    unavailableValueLabel:
      value == null
        ? hasHoldings
          ? t("portfolio-metric-unavailable")
          : t("no-holdings")
        : undefined,
    formatOptions: percentFormat,
    changeType: changeTypeOf(value),
    changePositiveDirection: "up",
    helperText: description,
  });

  const unrealizedGainsChangeType =
    summary.unrealizedGains === 0
      ? null
      : summary.unrealizedGains > 0
        ? "increase"
        : "decrease";

  const realizedGainsChangeType =
    summary.realizedGains === 0
      ? null
      : summary.realizedGains > 0
        ? "increase"
        : "decrease";

  const stats: StatsItem[] = [
    {
      name: t("total-value"),
      value: summary.totalValue,
      formatOptions: {
        style: "currency",
        currency: summary.currency || "USD",
        maximumFractionDigits: 2,
      },
      changeValue: isAggregate
        ? t("portfolio-count", { count: summary.portfolioCount ?? 0 })
        : summary.currency,
    },
    {
      name: t("total-gain-loss"),
      value: summary.totalGainLoss,
      formatOptions: {
        style: "currency",
        currency: summary.currency || "USD",
        maximumFractionDigits: 2,
        signDisplay: "always",
      },
      changeType: gainLossChangeType,
      changeValue: formatPercentage(summary.totalGainLossPercent / 100),
      changePositiveDirection: "up",
    },
    {
      name: t("unrealized-gains"),
      value: summary.unrealizedGains,
      formatOptions: {
        style: "currency",
        currency: summary.currency || "USD",
        maximumFractionDigits: 2,
        signDisplay: "always",
      },
      changeType: unrealizedGainsChangeType,
      changePositiveDirection: "up",
    },
    {
      name: t("realized-gains"),
      value: summary.realizedGains,
      formatOptions: {
        style: "currency",
        currency: summary.currency || "USD",
        maximumFractionDigits: 2,
        signDisplay: "always",
      },
      changeType: realizedGainsChangeType,
      changePositiveDirection: "up",
      notice: summary.feeConversionIncompleteAssetKeys?.length ? (
        <FeeConversionNotice scope="gains" />
      ) : undefined,
    },
    // The period's figures share the second row: the simple change net of
    // contributions, then the two that weigh cash flows differently.
    {
      name: `${summary.periodLabel} ${t("return")}`,
      value: isPeriodReturnUnavailable
        ? null
        : (summary.periodReturn as number) / 100,
      unavailableValueLabel: periodReturnUnavailableValueLabel,
      formatOptions: percentFormat,
      changeType: periodReturnChangeType,
      changePositiveDirection: "up",
      helperText: periodReturnHelperText,
    },
    ...(periodReturns
      ? [
          returnStat(
            t("time-weighted-return"),
            periodReturns.timeWeighted,
            t("time-weighted-return-description"),
          ),
          returnStat(
            periodReturns.moneyWeightedAnnualized
              ? t("money-weighted-return-annualized")
              : t("money-weighted-return"),
            periodReturns.moneyWeighted,
            t("money-weighted-return-description"),
          ),
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <Stats stats={stats} columns={4} />
      {missingSnapshotCount > 0 ? (
        <MissingSnapshotsNote count={missingSnapshotCount} />
      ) : null}
      {/* `lastUpdated` was being fetched on every dashboard request and never
          rendered — a valuation with no "as of" reads as live. § 9 rule 6. */}
      <DataProvenance
        updatedAt={summary.lastUpdated}
        label={(time) => t("provenance-portfolio-updated", { time })}
      />
    </div>
  );
};

export default PortfolioDashboardSummary;
