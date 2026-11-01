"use client";

import { useTranslations } from "next-intl";
import React from "react";

import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import useHoldingValuation from "@/lib/api/portfolio/useHoldingValuation";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface HoldingValuationMetricsProps {
  symbol: string;
}

const HoldingValuationMetrics: React.FC<HoldingValuationMetricsProps> = ({
  symbol,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const { data, isLoading } = useHoldingValuation(symbol);

  if (isLoading) {
    return (
      <div className="flex h-[100px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!data?.valuation) {
    return null;
  }

  const { valuation } = data;

  const metrics = [
    { label: t("pe-ratio"), value: valuation.peRatio },
    { label: t("pb-ratio"), value: valuation.pbRatio },
    { label: t("roe"), value: valuation.roe, isPercent: true },
    { label: t("dividend-yield"), value: valuation.dividendYield, isPercent: true },
    { label: t("ev-ebitda"), value: valuation.evToEbitda },
    { label: t("current-ratio"), value: valuation.currentRatio },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Text as="h4" className="text-xs font-medium text-muted-foreground">
        {t("market-valuation")}
      </Text>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="overflow-hidden rounded-lg bg-muted/40 p-3"
          >
            <dt className="truncate text-xs text-muted-foreground">
              {metric.label}
            </dt>
            <dd className="mt-1 font-mono text-base font-semibold text-foreground">
              {metric.value != null
                ? metric.isPercent
                  ? formatPercentage(metric.value / 100, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : metric.value.toFixed(2)
                : "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export default HoldingValuationMetrics;
