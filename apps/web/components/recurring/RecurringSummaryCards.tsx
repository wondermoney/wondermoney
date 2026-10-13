import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import type { RecurringSummary } from "@/lib/api/recurring/useRecurringSummary";
import { cn } from "@/lib/utils";
import { formatCurrencyForScreenReader } from "@/lib/utils/formatCurrency";

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

const formatMoney = (value: number, currencyCode?: string, locale?: string) => {
  if (!isCurrencyCode(currencyCode)) {
    return new Intl.NumberFormat(locale, {
      notation: "standard",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value);
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    notation: "standard",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    currency: currencyCode,
  }).format(value);
};

const formatAccessibleMoney = (
  value: number,
  currencyCode?: string,
  locale?: string,
) =>
  formatCurrencyForScreenReader(
    value,
    isCurrencyCode(currencyCode) ? currencyCode : "EUR",
    locale ?? "en",
  );

function AmountLine({
  value,
  currencyCode,
  locale,
}: {
  value: number | null;
  currencyCode?: string;
  locale?: string;
}) {
  return value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="font-mono text-2xl leading-none font-semibold tracking-tight tabular-nums">
      <span className="sr-only">
        {formatAccessibleMoney(value, currencyCode, locale)}
      </span>
      <span aria-hidden="true">{formatMoney(value, currencyCode, locale)}</span>
    </span>
  );
}

function AmountRange({
  min,
  max,
  currencyCode,
  locale,
}: {
  min: number | null;
  max: number | null;
  currencyCode?: string;
  locale?: string;
}) {
  if (min === null && max === null) {
    return <AmountLine value={null} currencyCode={currencyCode} locale={locale} />;
  }

  const lower = min ?? max ?? 0;
  const upper = max ?? min ?? 0;
  const accessibleLabel =
    lower === upper
      ? formatAccessibleMoney(lower, currencyCode, locale)
      : `${formatAccessibleMoney(lower, currencyCode, locale)} – ${formatAccessibleMoney(upper, currencyCode, locale)}`;
  return (
    <span className="font-mono text-2xl leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums">
      <span className="sr-only">{accessibleLabel}</span>
      <span aria-hidden="true">
        {lower === upper
          ? formatMoney(lower, currencyCode, locale)
          : `${formatMoney(lower, currencyCode, locale)}–${formatMoney(upper, currencyCode, locale)}`}
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
                locale={locale}
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
        value={<AmountRange min={monthlyMinTotal} max={monthlyMaxTotal} currencyCode={currencyCode} locale={locale} />}
        hint={labels.estimateHint}
      />
      <SummaryCard
        label={labels.subscriptions}
        value={<AmountRange min={subscriptionMinTotal} max={subscriptionMaxTotal} currencyCode={currencyCode} locale={locale} />}
      />
      <SummaryCard
        label={labels.bills}
        value={<AmountRange min={billMinTotal} max={billMaxTotal} currencyCode={currencyCode} locale={locale} />}
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
