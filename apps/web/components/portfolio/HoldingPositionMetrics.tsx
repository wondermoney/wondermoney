"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import Text from "@/components/ui/Typography/Text";
import type { HoldingPositionSummary } from "@/lib/portfolio/holding-detail-summary";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

export function HoldingPositionMetrics({
  summary,
}: {
  summary: HoldingPositionSummary;
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  // Formatted in the reader's locale, not the runtime's.
  const locale = useLocale();
  const { formatQuantity, formatPercentPoint } = useMemo(() => {
    const quantity = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
    const percent = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return {
      formatPercentPoint: (value: number) => `${percent.format(value)}%`,
      formatQuantity: (value: number) => quantity.format(value),
    };
  }, [locale]);
  // Needs the active locale, so it lives inside the component.
  const formatMaybeCurrency = (value: number | null, currency: string) =>
    value === null ? "—" : formatCurrency(value, currency);
  const isCash = summary.type.toLowerCase() === "cash";
  const isSavingsCertificate =
    summary.type.toLowerCase() === "savings certificate";

  // Savings Certificates, like Cash, have no market price by design — they're
  // valued by accrual (shown in the CertificadoAforroAccrualPanel rendered
  // right below this component), so a "Price: — / Market data unavailable"
  // tile here would directly contradict the real data shown underneath it.
  const items: Array<{ label: string; value: string; helper?: string | null }> =
    isCash || isSavingsCertificate
      ? [
          {
            label: t("current-value"),
            value: formatMaybeCurrency(summary.currentValue, summary.currency),
            helper:
              summary.currentValue === null ? t("position-data-pending") : null,
          },
          {
            label: t("currency"),
            value: summary.currency,
          },
          {
            label: t("quantity"),
            value: formatQuantity(summary.quantity),
          },
          {
            label: t("portfolio-weight"),
            value:
              summary.portfolioWeight === null
                ? "—"
                : formatPercentPoint(summary.portfolioWeight),
          },
        ]
      : [
          {
            label: t("invested-amount"),
            value: formatCurrency(summary.investedAmount, summary.currency),
          },
          {
            label: t("average-cost"),
            value: formatCurrency(summary.averageCost, summary.currency),
          },
          {
            label: t("price"),
            value: formatMaybeCurrency(summary.currentPrice, summary.currency),
            helper:
              summary.currentPrice === null
                ? t("market-data-unavailable")
                : null,
          },
          {
            label: t("portfolio-weight"),
            value:
              summary.portfolioWeight === null
                ? "—"
                : formatPercentPoint(summary.portfolioWeight),
          },
        ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        // A tinted step, not a Card: this sits inside the holding dialog,
        // which is already the bordered, elevated surface (No-Nesting rule).
        <div key={item.label} className="bg-muted/30 space-y-1 rounded-lg p-4">
          <Text
            variant="mutedText"
            className="text-xs"
          >
            {item.label}
          </Text>
          <div
            className={cn(
              "font-mono text-lg font-semibold",
              item.value === "—" && "text-muted-foreground",
            )}
          >
            {item.value}
          </div>
          {item.helper ? (
            <Text variant="mutedText" className="text-xs">
              {item.helper}
            </Text>
          ) : null}
        </div>
      ))}
    </div>
  );
}
