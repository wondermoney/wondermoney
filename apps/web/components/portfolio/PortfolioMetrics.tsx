"use client";

import { useTranslations } from "next-intl";
import React from "react";

import { LearningTip } from "@/components/ui/learning-tip";
import type {
  PortfolioMetrics as PortfolioMetricsType,
  PortfolioMetricsReadiness,
} from "@/lib/api/portfolio/usePortfolioMetrics";
import { cn } from "@/lib/utils";
import { getDeltaClassName } from "@/lib/utils/formatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface PortfolioMetricsProps {
  metrics: PortfolioMetricsType & { readiness?: PortfolioMetricsReadiness };
}

const riskLevelColors = {
  Low: "text-foreground",
  Medium: "text-warning-text",
  High: "text-destructive-text",
};

const isMetricUnavailable = (value: number | string | null) => value == null;

// A yield is a rate of return — a delta — so direction is the information.
const getYieldColorClass = (value: number | null) =>
  value == null ? "text-muted-foreground" : getDeltaClassName(value);

const metricValueClass = "font-mono text-lg font-semibold tracking-tight";
const metricUnavailableValueClass =
  "text-muted-foreground text-xs font-normal leading-5 tracking-normal";

const metricReadinessOrder = [
  "holdings",
  "allocation",
  "performance",
  "riskMetrics",
] as const;

interface MetricCardProps {
  label: string;
  helperText?: string;
  tipAriaLabel?: string;
  tipLabel?: string;
  tooltip?: string;
  children: React.ReactNode;
}

function MetricCard({
  label,
  helperText,
  tipAriaLabel,
  tipLabel,
  tooltip,
  children,
}: MetricCardProps) {
  return (
    <div className="bg-muted/30 overflow-hidden rounded-lg p-3">
      <dt className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs sm:text-sm">
        <span>{label}</span>
        {tooltip && tipLabel ? (
          <LearningTip tooltip={tooltip} ariaLabel={tipAriaLabel ?? label}>
            {tipLabel}
          </LearningTip>
        ) : null}
      </dt>
      <dd className="mt-2 space-y-1">
        {children}
        {helperText ? (
          <p className="text-muted-foreground text-xs">{helperText}</p>
        ) : null}
      </dd>
    </div>
  );
}

const PortfolioMetrics: React.FC<PortfolioMetricsProps> = ({ metrics }) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();

  const annualYieldUnavailable = isMetricUnavailable(metrics.annualYield);
  const volatilityUnavailable = isMetricUnavailable(metrics.volatility);
  const sharpeUnavailable = isMetricUnavailable(metrics.sharpeRatio);
  const maxDrawdownUnavailable = isMetricUnavailable(metrics.maxDrawdown);
  const riskLevelUnavailable = isMetricUnavailable(metrics.riskLevel);
  const readiness = metrics.readiness;

  const readinessStatus =
    metricReadinessOrder
      .map((key) => readiness?.[key])
      .find((entry) => entry && entry.status !== "ready")?.status ?? null;

  const readinessMessage = (() => {
    if (!readinessStatus) return null;

    if (readinessStatus === "partial") {
      const partialKey = metricReadinessOrder.find((key) => {
        const entry = readiness?.[key];
        return entry?.status === "partial";
      });

      return partialKey === "holdings"
        ? t("portfolio-metrics-holdings-partial")
        : t("portfolio-metrics-allocation-partial");
    }

    if (readinessStatus === "empty") {
      return null;
    }

    if (readinessStatus === "insufficient_history") {
      const insufficientKey = metricReadinessOrder.find((key) => {
        const entry = readiness?.[key];
        return entry?.status === "insufficient_history";
      });

      return insufficientKey === "performance"
        ? t("portfolio-metrics-performance-insufficient-history")
        : t("portfolio-metrics-risk-insufficient-history");
    }

    return null;
  })();

  const unavailableCopy = {
    annualYield: t("portfolio-metric-annual-yield-unavailable"),
    volatility: t("portfolio-metric-volatility-unavailable"),
    sharpeRatio: t("portfolio-metric-sharpe-unavailable"),
    maxDrawdown: t("portfolio-metric-drawdown-unavailable"),
    riskLevel: t("portfolio-metric-risk-unavailable"),
  };

  return (
    <section className="border-border bg-card/70 rounded-lg border p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-medium">
            {t("advanced-metrics")}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t("advanced-metrics-description")}
          </p>
          {readinessMessage ? (
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              {readinessMessage}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label={t("annual-yield")} helperText={undefined}>
          <div
            className={cn(
              annualYieldUnavailable
                ? metricUnavailableValueClass
                : metricValueClass,
              !annualYieldUnavailable &&
                getYieldColorClass(metrics.annualYield),
            )}
          >
            {annualYieldUnavailable
              ? unavailableCopy.annualYield
              : formatPercentage((metrics.annualYield as number) / 100, {
                  maximumFractionDigits: 1,
                })}
          </div>
        </MetricCard>

        <MetricCard label={t("volatility")} helperText={undefined}>
          <div
            className={cn(
              volatilityUnavailable
                ? metricUnavailableValueClass
                : metricValueClass,
              !volatilityUnavailable && "text-foreground",
            )}
          >
            {volatilityUnavailable
              ? unavailableCopy.volatility
              : `${(metrics.volatility as number).toFixed(1)}%`}
          </div>
        </MetricCard>

        <MetricCard label={t("sharpe-ratio")} helperText={undefined}>
          <div
            className={cn(
              sharpeUnavailable
                ? metricUnavailableValueClass
                : metricValueClass,
              !sharpeUnavailable && "text-foreground",
            )}
          >
            {sharpeUnavailable
              ? unavailableCopy.sharpeRatio
              : (metrics.sharpeRatio as number).toFixed(2)}
          </div>
        </MetricCard>

        <MetricCard label={t("max-drawdown")} helperText={undefined}>
          <div
            className={cn(
              maxDrawdownUnavailable
                ? metricUnavailableValueClass
                : metricValueClass,
              maxDrawdownUnavailable
                ? undefined
                : metrics.maxDrawdown === 0
                  ? "text-foreground"
                  : "text-destructive-text",
            )}
          >
            {maxDrawdownUnavailable
              ? unavailableCopy.maxDrawdown
              : (metrics.maxDrawdown as number) === 0
                ? "0.0%"
                : `-${Math.abs(metrics.maxDrawdown as number).toFixed(1)}%`}
          </div>
        </MetricCard>

        <MetricCard
          label={t("risk-level")}
          tipAriaLabel={t("metric-help-label", { metric: t("risk-level") })}
          tooltip={!riskLevelUnavailable ? t("risk-level-tooltip") : undefined}
          helperText={undefined}
        >
          <div
            className={cn(
              riskLevelUnavailable
                ? metricUnavailableValueClass
                : "font-medium tracking-tight",
              riskLevelUnavailable
                ? undefined
                : riskLevelColors[
                    metrics.riskLevel as keyof typeof riskLevelColors
                  ],
            )}
          >
            {riskLevelUnavailable
              ? unavailableCopy.riskLevel
              : t(
                  (
                    metrics.riskLevel as "Low" | "Medium" | "High"
                  ).toLowerCase() as any,
                )}
          </div>
        </MetricCard>
      </dl>
    </section>
  );
};

export default PortfolioMetrics;
