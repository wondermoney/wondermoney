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
import useAccountsCashflow, {
  type AccountCashflow,
} from "@/lib/api/account/useAccountsCashflow";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";
import {
  cashflowScale,
  formatMonthName,
  monthComparisonRange,
  type SavingsSummary,
  savingsSummary,
} from "@/lib/home/month-overview";
import { cn } from "@/lib/utils";
import { formatPercentageForLocale } from "@/lib/utils/formatPercentage";

const MONTHS_SHOWN = 6;

/** The API buckets by `DATE_TRUNC('month')` in UTC; read the month back in UTC. */
const isSameUtcMonth = (iso: string, today: Date) => {
  const date = new Date(iso);
  return (
    date.getUTCFullYear() === today.getFullYear() &&
    date.getUTCMonth() === today.getMonth()
  );
};

/** A signed number of percentage points, without the percent sign Intl adds. */
const formatPoints = (points: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    signDisplay: "exceptZero",
    maximumFractionDigits: 1,
  })
    .format(points)
    // U+2212, the minus every rendered figure uses, not Intl's hyphen-minus.
    .replace("-", "\u2212");

function SummaryChange({
  delta,
  currency,
  goodWhenNegative,
  vs,
}: {
  delta: number | null;
  currency: string | undefined;
  /** Spending is the case: a fall is the good direction. */
  goodWhenNegative: boolean;
  vs: string | null;
}) {
  const t = useTranslations("homeOverview.cashflow");
  if (delta === null || vs === null) return null;

  return (
    <span className="text-muted-foreground text-xs">
      {t.rich("change", {
        amount: () => (
          <Amount
            value={delta}
            currency={currency}
            tone="delta"
            toneValue={goodWhenNegative ? -delta : delta}
            signed
            className="font-mono"
          />
        ),
        vs,
      })}
    </span>
  );
}

function RateChange({
  delta,
  vs,
  locale,
}: {
  delta: number | null;
  vs: string | null;
  locale: string;
}) {
  const t = useTranslations("homeOverview.cashflow");
  if (delta === null || vs === null) return null;

  const tone =
    delta > 0
      ? "text-success-text"
      : delta < 0
        ? "text-destructive-text"
        : "text-muted-foreground";

  return (
    <span className="text-muted-foreground text-xs">
      {t.rich("rate-change", {
        points: () => (
          <span className={cn("font-mono", tone)}>
            {t("points", { points: formatPoints(delta, locale) })}
          </span>
        ),
        vs,
      })}
    </span>
  );
}

/**
 * This month's income, spending and savings rate, each beside the same figure
 * for the comparison period. While the month is running the comparison is the
 * same number of days last month, so a part is never set against a whole.
 */
function ThisMonthSummary({
  summary,
  currency,
  locale,
}: {
  summary: SavingsSummary;
  currency: string | undefined;
  locale: string;
}) {
  const t = useTranslations("homeOverview.cashflow");
  const comparison = summary.comparison;
  const vs = comparison
    ? comparison.samePoint
      ? t("vs-same-point")
      : t("vs", { month: formatMonthName(comparison.month, locale) })
    : null;

  return (
    <div className="border-border mb-6 border-b pb-4">
      <h3 className="text-foreground mb-3 text-base font-medium">
        {t("this-month")}
      </h3>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted-foreground text-sm">{t("income")}</dt>
          <dd className="text-foreground font-mono text-lg">
            <Amount value={summary.income} currency={currency} />
          </dd>
          <dd>
            <SummaryChange
              delta={summary.incomeDelta}
              currency={currency}
              goodWhenNegative={false}
              vs={vs}
            />
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted-foreground text-sm">{t("spending")}</dt>
          <dd className="text-foreground font-mono text-lg">
            <Amount value={summary.spending} currency={currency} />
          </dd>
          <dd>
            <SummaryChange
              delta={summary.spendingDelta}
              currency={currency}
              goodWhenNegative
              vs={vs}
            />
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted-foreground text-sm">{t("savings-rate")}</dt>
          <dd className="text-foreground font-mono text-lg">
            {summary.savingsRate === null
              ? "—"
              : formatPercentageForLocale(summary.savingsRate, locale, {
                  maximumFractionDigits: 0,
                })}
          </dd>
          <dd>
            <RateChange
              delta={summary.savingsRateDelta}
              vs={vs}
              locale={locale}
            />
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-3 max-w-prose text-sm">
        {t("formula")}
      </p>
    </div>
  );
}

/**
 * Net cash flow per month as bars diverging from one zero line, the current
 * month in the chart's lead colour and every other month neutral. Each bar
 * carries its signed figure, so direction never rests on colour or side alone.
 * Above them, this month's income, spending and savings rate, each with its
 * change from the comparison period.
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
  const comparisonRange = useMemo(() => monthComparisonRange(today), [today]);
  // The current month is month-to-date: bound the read at today, so a
  // future-dated row cannot make the summary claim more than has happened.
  const { data, isPending, error, refetch } = useAccountsCashflow({
    fromDate,
    toDate: today,
  });
  // The same-point comparison is a second, bounded read of the same endpoint,
  // and only worth making when this month has a row to compare.
  const hasCurrentMonth =
    data?.cashflow.some((row) => isSameUtcMonth(row.date, today)) ?? false;
  const comparison = useAccountsCashflow(
    {
      fromDate: comparisonRange.from,
      toDate: comparisonRange.to,
    },
    { enabled: hasCurrentMonth },
  );
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

  const currentRow: AccountCashflow | undefined = data.cashflow.find((row) =>
    isSameUtcMonth(row.date, today),
  );
  const summary = savingsSummary(
    currentRow,
    comparison.data?.cashflow[0],
    comparisonRange,
  );

  const monthLabel = (iso: string) =>
    formatMonthName(new Date(iso), locale, { short: true, utc: true });

  return (
    <Section id="cashflow-heading" title={t("title")}>
      {summary ? (
        <ThisMonthSummary
          summary={summary}
          currency={currency}
          locale={locale}
        />
      ) : null}
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
