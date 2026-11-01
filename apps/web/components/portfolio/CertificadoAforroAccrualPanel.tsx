"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Card, CardContent } from "@/components/ui/card";
import Text from "@/components/ui/Typography/Text";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

const lotDateFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
} as const;

/**
 * `currentRateBps`/`premiumTierBps` are basis points (350 => 3.5%).
 * `formatPercentage` uses `Intl.NumberFormat`'s `style: "percent"`, which
 * multiplies its input by 100 to render the "%" — so a bps value has to be
 * turned into a fraction first (350 / 10000 = 0.035), not just divided by
 * 100 (which would render as "350%").
 */
interface CertificadoAforroAccrualPanelProps {
  holding: PortfolioHolding;
}

export function CertificadoAforroAccrualPanel({
  holding,
}: CertificadoAforroAccrualPanelProps) {
  const formatPercentage = useFormatPercentage();
  // Inside the component because it needs the active locale. See the
  // note above on why bps must become a fraction before `style: "percent"`.
  const formatBpsAsPercentage = (bps: number) =>
    formatPercentage(bps / 10000, { maximumFractionDigits: 2 });
  const t = useTranslations();
  const locale = useLocale();
  const lotDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, lotDateFormatOptions),
    [locale],
  );
  const yearsHeldFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    [locale],
  );
  const formatCurrency = useFormatCurrency();
  const detail = holding.certificadoAforroDetail;

  if (!detail) {
    return (
      <Card className="w-full">
        <CardContent className="flex min-h-[120px] items-center justify-center p-6 text-center">
          <Text variant="smallText" className="text-muted-foreground">
            {t("market-data-unavailable")}
          </Text>
        </CardContent>
      </Card>
    );
  }

  const metrics = [
    {
      key: "current-rate",
      label: t("portfolio-ca-accrual-current-rate"),
      value: formatBpsAsPercentage(detail.currentRateBps),
    },
    {
      key: "premium-tier",
      label: t("portfolio-ca-accrual-premium-tier"),
      value: formatBpsAsPercentage(detail.premiumTierBps),
    },
    {
      key: "next-capitalization",
      label: t("portfolio-ca-accrual-next-capitalization"),
      value: lotDateFormatter.format(new Date(detail.nextCapitalizationDate)),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <Text as="h3" className="text-muted-foreground text-sm font-medium">
        {t("portfolio-ca-accrual-panel-title")}
      </Text>

      <Card>
        <CardContent className="space-y-4 p-4">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="border-border/60 bg-muted/30 rounded-lg border p-3"
              >
                <dt className="text-muted-foreground text-xs font-medium">
                  {metric.label}
                </dt>
                <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-2">
            <Text
              variant="smallText"
              className="text-muted-foreground font-medium"
            >
              {t("portfolio-ca-accrual-per-lot-title")}
            </Text>
            <div className="flex flex-col gap-2">
              {detail.lots.map((lot) => (
                <div
                  key={lot.transactionKey}
                  className="border-border/60 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-md border p-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <Text variant="smallText" className="text-muted-foreground">
                      {t("portfolio-ca-accrual-lot-subscribed")}
                    </Text>
                    <Text variant="smallText" className="font-medium">
                      {lotDateFormatter.format(new Date(lot.subscriptionDate))}
                    </Text>
                    <Text variant="smallText" className="text-muted-foreground">
                      {t(
                        lot.taxExempt
                          ? "portfolio-ca-accrual-tax-status-exempt"
                          : "portfolio-ca-accrual-tax-status-standard",
                      )}
                    </Text>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <Text variant="smallText" className="text-muted-foreground">
                      {t("portfolio-ca-accrual-years-held")}
                    </Text>
                    <Text
                      variant="smallText"
                      className="font-mono font-medium tabular-nums"
                    >
                      {yearsHeldFormatter.format(lot.yearsHeld)}
                    </Text>
                  </div>

                  <div className="flex flex-col items-end gap-0.5">
                    <Text variant="smallText" className="text-muted-foreground">
                      {t("portfolio-ca-accrual-lot-principal")}
                    </Text>
                    <Text
                      variant="smallText"
                      className="font-mono font-medium tabular-nums"
                    >
                      <Amount value={lot.principal} currency={holding.currency} />
                    </Text>
                  </div>

                  <div className="flex flex-col items-end gap-0.5">
                    <Text variant="smallText" className="text-muted-foreground">
                      {t("portfolio-ca-accrual-lot-accrued-value")}
                    </Text>
                    <Text
                      variant="smallText"
                      className="font-mono font-semibold tabular-nums"
                    >
                      <Amount value={lot.accruedValue} currency={holding.currency} />
                    </Text>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Text variant="smallText" className="text-muted-foreground">
            {t("portfolio-ca-accrual-disclaimer")}
          </Text>
        </CardContent>
      </Card>
    </section>
  );
}

