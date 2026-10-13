import type { ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { RecurringItem } from "@/lib/api/recurring/useRecurringItems";
import { cn } from "@/lib/utils";
import { formatCurrencyForScreenReader } from "@/lib/utils/formatCurrency";

type ImpactItem = RecurringItem;

export interface RecurringCategoryImpactLabels {
  title?: ReactNode;
  emptyState?: ReactNode;
  uncategorizedLabel?: ReactNode;
  categoryLabel?: (item: ImpactItem) => ReactNode;
  paymentCount?: (count: number) => ReactNode;
  shareLabel?: (percentage: number) => string;
}

export interface RecurringCategoryImpactProps {
  items: ImpactItem[];
  currencyCode?: string;
  getCurrencyCode?: (item: ImpactItem) => string | undefined;
  locale?: string;
  labels: RecurringCategoryImpactLabels;
  className?: string;
}

type CategoryGroup = {
  key: string;
  label: ReactNode;
  amountMax: number;
  amountMin: number;
  count: number;
  currencyCode?: string;
};

const cadenceMonthlyMultiplier: Record<ImpactItem["cadence"], number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

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

const getRecurringRange = (item: ImpactItem) => {
  const multiplier = cadenceMonthlyMultiplier[item.cadence];
  if (item.amountType === "fixed") {
    const value = item.expectedAmount ?? item.averageAmount ?? item.lastAmount;
    const monthlyValue = isFiniteNumber(value) ? value * multiplier : 0;
    return { max: monthlyValue, min: monthlyValue };
  }

  const min = isFiniteNumber(item.expectedAmountMin)
    ? item.expectedAmountMin
    : null;
  const max = isFiniteNumber(item.expectedAmountMax)
    ? item.expectedAmountMax
    : null;

  if (min !== null && max !== null) {
    return {
      max: Math.max(min, max) * multiplier,
      min: Math.min(min, max) * multiplier,
    };
  }

  const fallback = item.averageAmount ?? item.lastAmount;
  const monthlyValue = isFiniteNumber(fallback) ? fallback * multiplier : 0;
  return { max: monthlyValue, min: monthlyValue };
};

const formatRange = (
  min: number,
  max: number,
  currencyCode?: string,
  locale?: string,
) =>
  min === max
    ? formatMoney(min, currencyCode, locale)
    : `${formatMoney(min, currencyCode, locale)}–${formatMoney(max, currencyCode, locale)}`;

const formatAccessibleRange = (
  min: number,
  max: number,
  currencyCode?: string,
  locale?: string,
) => {
  const accessibleMoney = (value: number) =>
    formatCurrencyForScreenReader(
      value,
      isCurrencyCode(currencyCode) ? currencyCode : "EUR",
      locale ?? "en",
    );

  return min === max
    ? accessibleMoney(min)
    : `${accessibleMoney(min)} – ${accessibleMoney(max)}`;
};

export function RecurringCategoryImpact({
  items,
  currencyCode,
  getCurrencyCode,
  locale,
  labels,
  className,
}: RecurringCategoryImpactProps) {
  if (items.length === 0) {
    return labels.emptyState ? <>{labels.emptyState}</> : null;
  }

  const categories = new Map<string, CategoryGroup>();

  items.forEach((item) => {
    const itemCurrencyCode =
      getCurrencyCode?.(item) ?? currencyCode ?? item.currency?.code;
    const baseKey = item.category?.categoryKey
      ? String(item.category.categoryKey)
      : (item.category?.name ?? "uncategorized");
    const key = `${baseKey}::${itemCurrencyCode ?? "EUR"}`;
    const label =
      labels.categoryLabel?.(item) ??
      item.category?.name ??
      labels.uncategorizedLabel;

    if (!label) return;

    const current = categories.get(key) ?? {
      key,
      label,
      amountMax: 0,
      amountMin: 0,
      count: 0,
      currencyCode: itemCurrencyCode,
    };
    const range = getRecurringRange(item);
    current.amountMax += range.max;
    current.amountMin += range.min;
    current.count += 1;
    categories.set(key, current);
  });

  const grouped = [...categories.values()].sort(
    (left, right) =>
      right.amountMin + right.amountMax - (left.amountMin + left.amountMax),
  );
  const totalsByCurrency = grouped.reduce<Record<string, number>>(
    (totals, group) => {
      const key = group.currencyCode ?? "unknown";
      totals[key] =
        (totals[key] ?? 0) + (group.amountMin + group.amountMax) / 2;
      return totals;
    },
    {},
  );

  if (grouped.length === 0) {
    return labels.emptyState ? <>{labels.emptyState}</> : null;
  }

  return (
    <Card className={className}>
      {labels.title ? (
        <CardHeader className="pb-3">
          <div className="text-sm font-medium">{labels.title}</div>
        </CardHeader>
      ) : null}
      <CardContent className={cn("space-y-4", labels.title ? "pt-0" : "pt-6")}>
        {grouped.map((group) => {
          const total = totalsByCurrency[group.currencyCode ?? "unknown"] ?? 0;
          const midpoint = (group.amountMin + group.amountMax) / 2;
          const share = total > 0 ? (midpoint / total) * 100 : 0;
          const roundedShare = Math.round(share * 10) / 10;

          return (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {group.label}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {labels.paymentCount?.(group.count) ??
                      new Intl.NumberFormat(locale).format(group.count)}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {labels.shareLabel?.(roundedShare) ?? `${roundedShare}%`}
                  </div>
                </div>

                <div className="font-mono text-sm font-medium whitespace-nowrap tabular-nums">
                  <span className="sr-only">
                    {formatAccessibleRange(
                      group.amountMin,
                      group.amountMax,
                      group.currencyCode,
                      locale,
                    )}
                  </span>
                  <span aria-hidden="true">
                    {formatRange(
                      group.amountMin,
                      group.amountMax,
                      group.currencyCode,
                      locale,
                    )}
                  </span>
                </div>
              </div>

              <meter
                className="sr-only"
                min={0}
                max={100}
                value={roundedShare}
                aria-label={labels.shareLabel?.(roundedShare)}
              />
              <div
                className="bg-muted h-2 overflow-hidden rounded-full"
                aria-hidden="true"
              >
                <div
                  className="bg-primary/70 h-full rounded-full"
                  style={{ width: `${share}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
