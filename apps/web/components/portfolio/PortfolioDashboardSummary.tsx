"use client";

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
      name: `${summary.periodLabel} ${t("return")}`,
      value: isPeriodReturnUnavailable
        ? null
        : (summary.periodReturn as number) / 100,
      unavailableValueLabel: periodReturnUnavailableValueLabel,
      formatOptions: {
        style: "percent",
        maximumFractionDigits: 2,
        signDisplay: "always",
      },
      changeType: periodReturnChangeType,
      changePositiveDirection: "up",
      helperText: periodReturnHelperText,
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
  ];

  return (
    <div className="flex flex-col gap-2">
      <Stats stats={stats} />
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
