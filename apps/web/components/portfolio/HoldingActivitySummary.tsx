"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import Text from "@/components/ui/Typography/Text";
import type { HoldingActivitySummary as HoldingActivitySummaryData } from "@/lib/portfolio/holding-detail-summary";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

const activityDateFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
} as const;

const formatActivityDate = (
  formatter: Intl.DateTimeFormat,
  value: Date | null,
) => {
  if (!value) return null;

  return formatter.format(value);
};

type HoldingActivitySummaryProps = {
  summary: HoldingActivitySummaryData;
  currency: string;
};

export function HoldingActivitySummary({
  summary,
  currency,
}: HoldingActivitySummaryProps) {
  const t = useTranslations();
  const locale = useLocale();
  const activityDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, activityDateFormatOptions),
    [locale],
  );
  const formatCurrency = useFormatCurrency();

  const items = [
    {
      key: "total-bought",
      label: t("total-bought"),
      value: formatCurrency(summary.totalBought, currency),
      isZero: summary.totalBought === 0,
    },
    {
      key: "total-sold",
      label: t("total-sold"),
      value: formatCurrency(summary.totalSold, currency),
      isZero: summary.totalSold === 0,
    },
    {
      key: "net-invested",
      label: t("net-invested"),
      value: formatCurrency(summary.netInvested, currency),
      isZero: summary.netInvested === 0,
    },
    {
      key: "dividends-received",
      label: t("dividends-received"),
      value: formatCurrency(summary.dividendsReceived, currency),
      isZero: summary.dividendsReceived === 0,
    },
  ];

  const firstTransactionDate = formatActivityDate(
    activityDateFormatter,
    summary.firstTransactionDate,
  );
  const lastTransactionDate = formatActivityDate(
    activityDateFormatter,
    summary.lastTransactionDate,
  );
  const showLastActivity =
    Boolean(firstTransactionDate) &&
    Boolean(lastTransactionDate) &&
    firstTransactionDate !== lastTransactionDate;

  return (
    <section className="flex flex-col gap-3">
      <Text as="h3" className="text-sm font-medium text-muted-foreground">
        {t("activity")}
      </Text>

      {/* No Card here: the holding dialog is already the surface, and the
          figures below carry their own tinted step (No-Nesting rule). */}
      <div className="space-y-4">
        {firstTransactionDate ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t("transactions-since", {
                count: summary.transactionCount,
                date: firstTransactionDate,
              })}
            </span>
            {showLastActivity ? (
              <span>
                {t("last-activity")}: {lastTransactionDate}
              </span>
            ) : null}
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-lg bg-muted/30 p-3"
            >
              <dt className="text-xs font-medium text-muted-foreground">
                {item.label}
              </dt>
              <dd
                className={cn(
                  "mt-1 font-mono text-lg font-semibold tabular-nums",
                  item.isZero && "text-muted-foreground",
                )}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

