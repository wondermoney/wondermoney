"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";
import Text from "@/components/ui/Typography/Text";
import type { HoldingPositionSummary } from "@/lib/portfolio/holding-detail-summary";
import { cn } from "@/lib/utils";
import { getDeltaClassName } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { FinancialAssetLogo } from "../FinancialAssetLogo";

export function HoldingPositionHeader({
  summary,
}: {
  summary: HoldingPositionSummary;
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  // RAD-575 — these were module-level `Intl` instances with an `undefined`
  // locale, so quantities and percentage points followed the runtime rather
  // than the reader. Memoised per locale rather than rebuilt each render.
  const locale = useLocale();
  const { formatQuantity, formatPercentPoint } = useMemo(() => {
    const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
    const percent = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    const signedPercent = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: "always",
    });
    return {
      formatPercentPoint: (value: number, { signed = false } = {}) =>
        `${(signed ? signedPercent : percent).format(value)}%`,
      formatQuantity: (value: number) => quantity.format(value),
    };
  }, [locale]);

  const currentValue =
    summary.currentValue === null
      ? "—"
      : formatCurrency(summary.currentValue, summary.currency);
  const unrealizedAmount =
    summary.unrealizedGains === null
      ? "—"
      : formatCurrency(summary.unrealizedGains, summary.currency);
  const unrealizedValueClassName =
    summary.unrealizedGains === null
      ? "text-muted-foreground"
      : getDeltaClassName(summary.unrealizedGains);
  const currentValueClassName =
    summary.currentValue === null ? "text-muted-foreground" : "text-foreground";
  const unrealizedPercentage =
    summary.unrealizedGainsPercentage === null
      ? null
      : formatPercentPoint(summary.unrealizedGainsPercentage, { signed: true });

  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-6">
        <div className="flex items-start gap-3">
          {summary.logoUrl ? (
            <FinancialAssetLogo
              symbol={summary.symbol}
              logoUrl={summary.logoUrl}
              priority
            />
          ) : null}
          <div className="space-y-1">
            <div className="font-mono text-xl leading-none font-semibold">
              {summary.symbol}
            </div>
            <Text variant="mutedText" className="text-sm">
              {t("your-position-in", { assetName: summary.name })}
            </Text>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="bg-muted/30 rounded-lg p-3">
            <Text
              variant="mutedText"
              className="text-xs tracking-wide uppercase"
            >
              {t("current-value")}
            </Text>
            <div
              className={cn(
                "mt-1 font-mono text-lg font-semibold",
                currentValueClassName,
              )}
            >
              {currentValue}
            </div>
            {summary.currentValue === null ? (
              <Text variant="mutedText" className="mt-1 text-xs">
                {t("position-data-pending")}
              </Text>
            ) : null}
          </div>

          <div className="bg-muted/30 rounded-lg p-3">
            <Text
              variant="mutedText"
              className="text-xs tracking-wide uppercase"
            >
              {t("unrealized-gain-loss")}
            </Text>
            <div
              className={cn(
                "mt-1 font-mono text-lg font-semibold",
                unrealizedValueClassName,
              )}
            >
              {unrealizedAmount}
              {unrealizedPercentage !== null ? (
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {unrealizedPercentage}
                </span>
              ) : null}
            </div>
          </div>

          <div className="bg-muted/30 rounded-lg p-3">
            <Text
              variant="mutedText"
              className="text-xs tracking-wide uppercase"
            >
              {t("quantity")}
            </Text>
            <div className="text-foreground mt-1 font-mono text-lg font-semibold">
              {formatQuantity(summary.quantity)}
            </div>
          </div>
        </div>

        {summary.isInvalid ? (
          <div className="border-warning-text/30 bg-warning/10 text-warning-text rounded-md border px-3 py-2 text-sm">
            <span className="font-medium">{t("invalid-position-data")}</span>
            {summary.invalidReason ? (
              <span className="ml-1">({summary.invalidReason})</span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
