import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import type { RecurringItem } from "@/lib/api/recurring/useRecurringItems";
import { cn } from "@/lib/utils";

import { RecurringAmountDisplay } from "./RecurringAmountDisplay";
import {
  RecurringStatusBadge,
  type RecurringStatusBadgeLabels,
} from "./RecurringStatusBadge";

export interface RecurringUpcomingTimelineLabels {
  statusLabels?: RecurringStatusBadgeLabels;
  expected?: ReactNode;
  expectedAround?: ReactNode;
  emptyState?: ReactNode;
  itemClassName?: string;
}

export interface RecurringUpcomingTimelineProps {
  items: RecurringItem[];
  currencyCode?: string;
  getCurrencyCode?: (item: RecurringItem) => string | undefined;
  locale?: string;
  labels: RecurringUpcomingTimelineLabels;
  dateFormatter?: (date: Date) => string;
  referenceTime?: number;
  className?: string;
}

const compareDate = (left: RecurringItem, right: RecurringItem) => {
  const leftTime = left.nextExpectedAt
    ? new Date(left.nextExpectedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const rightTime = right.nextExpectedAt
    ? new Date(right.nextExpectedAt).getTime()
    : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
};

const defaultDateFormatter = (date: Date, locale?: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);

const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

export function RecurringUpcomingTimeline({
  items,
  currencyCode,
  getCurrencyCode,
  locale,
  labels,
  dateFormatter,
  referenceTime = Number.NEGATIVE_INFINITY,
  className,
}: RecurringUpcomingTimelineProps) {
  const orderedItems = items
    .filter((item) => {
      if (!item.nextExpectedAt) return false;
      const timestamp = new Date(item.nextExpectedAt).getTime();
      return Number.isFinite(timestamp) && timestamp > referenceTime;
    })
    .sort(compareDate);
  const formatDate =
    dateFormatter ?? ((date: Date) => defaultDateFormatter(date, locale));

  if (orderedItems.length === 0) {
    return labels.emptyState ? <>{labels.emptyState}</> : null;
  }

  return (
    <Card className={className}>
      <CardContent className="p-0">
        <ul className="space-y-0">
          {orderedItems.map((item, index) => {
            const nextExpectedAt = item.nextExpectedAt
              ? new Date(item.nextExpectedAt)
              : null;
            const dateLabel = nextExpectedAt ? formatDate(nextExpectedAt) : "—";

            return (
              <li
                key={item.recurringSeriesKey}
                className={cn(
                  "flex gap-4 px-4 py-4 md:px-6",
                  labels.itemClassName,
                )}
              >
                <div className="flex flex-col items-center pt-1">
                  <span className="bg-primary size-2 rounded-full" />
                  {index < orderedItems.length - 1 ? (
                    <span className="bg-border mt-2 h-full min-h-8 w-px" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium">
                      {item.displayName}
                    </h3>
                    {labels.statusLabels ? (
                      <RecurringStatusBadge
                        status={item.status}
                        confidenceScore={item.confidenceScore}
                        labels={labels.statusLabels}
                      />
                    ) : null}
                  </div>

                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                    <span className="font-mono tabular-nums">
                      {labels.expectedAround ? (
                        <>
                          <span className="mr-1">
                            {labels.expectedAround}
                          </span>
                          <span>{dateLabel}</span>
                        </>
                      ) : (
                        dateLabel
                      )}
                    </span>
                    <span className="text-border">•</span>
                    <RecurringAmountDisplay
                      item={item}
                      currencyCode={
                        getCurrencyCode?.(item) ??
                        currencyCode ??
                        (isCurrencyCode(item.currency?.code)
                          ? item.currency?.code
                          : undefined)
                      }
                      locale={locale}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
