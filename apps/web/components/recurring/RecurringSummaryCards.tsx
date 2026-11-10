"use client";

import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import type { RecurringSummary } from "@/lib/api/recurring/useRecurringSummary";
import { cn } from "@/lib/utils";
import {
  useFormatCurrency,
  useFormatCurrencyForScreenReader,
} from "@/lib/utils/useFormatCurrency";

type SummaryLike = Partial<RecurringSummary> | null | undefined;
type SummaryCurrencyTotals = Record<string, unknown>;

export interface RecurringSummaryCardsLabels {
  monthlyEstimate: ReactNode;
  subscriptions: ReactNode;
  bills: ReactNode;
  needsReview: ReactNode;
  estimateHint?: ReactNode;
  reviewActionLabel?: string;
}

export interface RecurringSummaryCardsProps {
  summary: SummaryLike;
  currencyCode?: string;
  locale?: string;
  labels: RecurringSummaryCardsLabels;
  className?: string;
  onReviewClick?: () => void;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

/** Money for the summary cards; a non-ISO code formats as a plain number. */
function useSummaryMoney() {
  const format = useFormatCurrency();
  const formatSpoken = useFormatCurrencyForScreenReader();
  return {
    formatMoney: (value: number, currencyCode?: string) =>
      format(value, currencyCode ?? "", { minimumFractionDigits: 2 }),
    formatAccessibleMoney: (value: number, currencyCode?: string) =>
      formatSpoken(value, isCurrencyCode(currencyCode) ? currencyCode : "EUR"),
  };
}

function AmountLine({
  value,
  currencyCode,
}: {
  value: number | null;
  currencyCode?: string;
}) {
  const { formatMoney, formatAccessibleMoney } = useSummaryMoney();
  return value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="font-mono text-2xl leading-none font-semibold tracking-tight tabular-nums">
      <span className="sr-only">
        {formatAccessibleMoney(value, currencyCode)}
      </span>
      <span aria-hidden="true">{formatMoney(value, currencyCode)}</span>
    </span>
  );
}

function AmountRange({
  min,
  max,
  currencyCode,
}: {
  min: number | null;
  max: number | null;
  currencyCode?: string;
}) {
  const { formatMoney, formatAccessibleMoney } = useSummaryMoney();
  if (min === null && max === null) {
    return <AmountLine value={null} currencyCode={currencyCode} />;
  }

  const lower = min ?? max ?? 0;
  const upper = max ?? min ?? 0;
  const accessibleLabel =
    lower === upper
      ? formatAccessibleMoney(lower, currencyCode)
      : `${formatAccessibleMoney(lower, currencyCode)} – ${formatAccessibleMoney(upper, currencyCode)}`;
  return (
    <span className="font-mono text-2xl leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums">
      <span className="sr-only">{accessibleLabel}</span>
      <span aria-hidden="true">
        {lower === upper
          ? formatMoney(lower, currencyCode)
          : `${formatMoney(lower, currencyCode)}–${formatMoney(upper, currencyCode)}`}
      </span>
    </span>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  onClick,
  actionLabel,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const content = (
    <div className="flex min-h-24 flex-col gap-2 p-6 text-left">
      <div className="text-muted-foreground text-sm">{label}</div>
      {value}
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );

  return (
    <Card className={cn(onClick && "focus-within:ring-ring transition-colors hover:bg-muted/30 focus-within:ring-2")}>
      {onClick ? (
        <button
          type="button"
          className="min-h-11 w-full rounded-xl"
          onClick={onClick}
          aria-label={actionLabel}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </Card>
  );
}

export function RecurringSummaryCards({
  summary,
  currencyCode,
  locale,
  labels,
  className,
  onReviewClick,
}: RecurringSummaryCardsProps) {
  const monthlyMinTotal = isFiniteNumber(summary?.monthlyMinTotal)
    ? summary.monthlyMinTotal
    : null;
  const monthlyMaxTotal = isFiniteNumber(summary?.monthlyMaxTotal)
    ? summary.monthlyMaxTotal
    : null;
  const subscriptionMinTotal = isFiniteNumber(summary?.subscriptionMinTotal)
    ? summary.subscriptionMinTotal
    : null;
  const subscriptionMaxTotal = isFiniteNumber(summary?.subscriptionMaxTotal)
    ? summary.subscriptionMaxTotal
    : null;
  const billMinTotal = isFiniteNumber(summary?.billMinTotal)
    ? summary.billMinTotal
    : null;
  const billMaxTotal = isFiniteNumber(summary?.billMaxTotal)
    ? summary.billMaxTotal
    : null;
  const needsReviewCount = isFiniteNumber(summary?.needsReviewCount)
    ? summary!.needsReviewCount
    : null;
  const currencyTotals = summary?.currencyTotals as
    | SummaryCurrencyTotals
    | undefined;
  const currencySummaryEntries = currencyTotals
    ? Object.entries(currencyTotals).flatMap(([code, value]) => {
        if (!isCurrencyCode(code)) return [];
        if (typeof value === "number") {
          return [{ code, totals: { monthlyTotal: value } }];
        }

        if (value && typeof value === "object") {
          return [{ code, totals: value as Record<string, unknown> }];
        }

        return [];
      })
    : [];

  if (currencySummaryEntries.length > 1) {
    return (
      <div
        className={cn("grid gap-4 md:grid-cols-2 2xl:grid-cols-4", className)}
      >
        {currencySummaryEntries.map(({ code, totals }) => (
          <Card key={code}>
            <CardContent className="flex flex-col gap-2 p-6">
              <div className="text-muted-foreground text-sm">{code}</div>
              <AmountRange
                min={isFiniteNumber(totals.monthlyMinTotal) ? totals.monthlyMinTotal : null}
                max={isFiniteNumber(totals.monthlyMaxTotal) ? totals.monthlyMaxTotal : null}
                currencyCode={code}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-4 md:grid-cols-2 2xl:grid-cols-4", className)}>
      <SummaryCard
        label={labels.monthlyEstimate}
        value={<AmountRange min={monthlyMinTotal} max={monthlyMaxTotal} currencyCode={currencyCode} />}
        hint={labels.estimateHint}
      />
      <SummaryCard
        label={labels.subscriptions}
        value={<AmountRange min={subscriptionMinTotal} max={subscriptionMaxTotal} currencyCode={currencyCode} />}
      />
      <SummaryCard
        label={labels.bills}
        value={<AmountRange min={billMinTotal} max={billMaxTotal} currencyCode={currencyCode} />}
      />
      <SummaryCard
        label={labels.needsReview}
        value={
          <div className="font-mono text-2xl leading-none font-semibold tracking-tight tabular-nums">
            {needsReviewCount === null ? <span className="text-muted-foreground">—</span> : new Intl.NumberFormat(locale).format(needsReviewCount)}
          </div>
        }
        onClick={needsReviewCount && needsReviewCount > 0 ? onReviewClick : undefined}
        actionLabel={labels.reviewActionLabel}
      />
    </div>
  );
}
