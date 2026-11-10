"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import DataLoadError from "@/components/ui/DataLoadError";
import {
  RowsSkeleton,
  Section,
  SectionEmpty,
} from "@/components/ui/RuledSection";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import useAccountsCashflow from "@/lib/api/account/useAccountsCashflow";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";
import { cashflowScale, formatMonthName } from "@/lib/home/month-overview";
import { cn } from "@/lib/utils";

const MONTHS_SHOWN = 6;

/** The API buckets by `DATE_TRUNC('month')` in UTC; read the month back in UTC. */
const isSameUtcMonth = (iso: string, today: Date) => {
  const date = new Date(iso);
  return (
    date.getUTCFullYear() === today.getFullYear() &&
    date.getUTCMonth() === today.getMonth()
  );
};

/**
 * Net cash flow per month as bars diverging from one zero line, the current
 * month in the chart's lead colour and every other month neutral. Each bar
 * carries its signed figure, so direction never rests on colour or side alone.
 */
export function CashflowSection() {
  const t = useTranslations("homeOverview.cashflow");
  const locale = useLocale();
  const today = useMemo(() => new Date(), []);
  const fromDate = useMemo(
    () =>
      new Date(today.getFullYear(), today.getMonth() - (MONTHS_SHOWN - 1), 1),
    [today],
  );
  const { data, isPending, error, refetch } = useAccountsCashflow({ fromDate });
  // The cash flow is summed in the user's currency, which net worth reports.
  const { data: netWorthData } = useNetWorth();
  const currency = netWorthData?.netWorth.currencyCode;

  if (isPending) {
    return (
      <Section id="cashflow-heading" title={t("title")} busy>
        <RowsSkeleton rows={MONTHS_SHOWN} />
      </Section>
    );
  }

  if (error) {
    return (
      <Section id="cashflow-heading" title={t("title")}>
        <DataLoadError error={error} onRetry={() => void refetch()} />
      </Section>
    );
  }

  const scale = cashflowScale(data.cashflow);

  if (scale.bars.length === 0) {
    return (
      <Section id="cashflow-heading" title={t("title")}>
        <SectionEmpty title={t("empty-title")} body={t("empty-body")} />
      </Section>
    );
  }

  const monthLabel = (iso: string) =>
    formatMonthName(new Date(iso), locale, { short: true, utc: true });

  return (
    <Section id="cashflow-heading" title={t("title")}>
      <ul
        aria-label={t("list-label", {
          from: monthLabel(scale.bars[0].date),
          to: monthLabel(scale.bars[scale.bars.length - 1].date),
        })}
      >
        {scale.bars.map((bar) => {
          const current = isSameUtcMonth(bar.date, today);
          return (
            <li
              key={bar.date}
              className="border-border grid min-h-11 grid-cols-[3rem_minmax(0,1fr)_7.5rem] items-center gap-4 border-b"
            >
              <span
                className={cn(
                  "text-sm",
                  current
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {monthLabel(bar.date)}
              </span>
              <span className="relative h-4" aria-hidden="true">
                <span
                  className="bg-foreground/60 absolute -inset-y-2.5 w-px"
                  style={{ left: `${scale.zero}%` }}
                />
                <span
                  className={cn(
                    "absolute inset-y-0.5",
                    bar.amount < 0 ? "bg-destructive-text" : "bg-success-text",
                    // Earlier months recede; this month is the one to read.
                    !current && "opacity-60",
                    bar.amount >= 0 ? "rounded-r-sm" : "rounded-l-sm",
                  )}
                  style={
                    bar.amount >= 0
                      ? { left: `${scale.zero}%`, width: `${bar.width}%` }
                      : {
                          right: `${100 - scale.zero}%`,
                          width: `${bar.width}%`,
                        }
                  }
                />
              </span>
              <Amount
                value={bar.amount}
                currency={currency}
                tone="delta"
                signed
                className={cn(
                  "text-right font-mono text-sm",
                  current && "font-semibold",
                )}
              />
            </li>
          );
        })}
      </ul>
      <UnconvertedAmountsNotice
        completeness={data.completeness}
        className="mt-3 max-w-prose"
      />
      <p className="text-muted-foreground mt-3 max-w-prose text-sm">
        {t("caption")}
      </p>
    </Section>
  );
}
