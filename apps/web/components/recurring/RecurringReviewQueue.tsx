"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { RecurringItem } from "@/lib/api/recurring/useRecurringItems";
import { cn } from "@/lib/utils";

import { RecurringAmountDisplay } from "./RecurringAmountDisplay";
import {
  RecurringStatusBadge,
  type RecurringStatusBadgeLabels,
} from "./RecurringStatusBadge";

type ReviewItem = RecurringItem;

export interface RecurringReviewQueueLabels {
  confirmAction: ReactNode;
  dismissAction: ReactNode;
  confirmActionLabel?: (merchant: string) => string;
  dismissActionLabel?: (merchant: string) => string;
  emptyState?: ReactNode;
  statusLabels: RecurringStatusBadgeLabels;
  explainability?: (item: ReviewItem) => ReactNode;
  occurrenceCount?: (count: number) => ReactNode;
  cadenceLabels?: Partial<Record<ReviewItem["cadence"], ReactNode>>;
  typeLabels?: Partial<Record<ReviewItem["type"], ReactNode>>;
  itemClassName?: string;
}

export interface RecurringReviewQueueProps {
  items: ReviewItem[];
  currencyCode?: string;
  getCurrencyCode?: (item: ReviewItem) => string | undefined;
  locale?: string;
  labels: RecurringReviewQueueLabels;
  onConfirm?: (recurringSeriesKey: number) => void | Promise<void>;
  onDismiss?: (recurringSeriesKey: number) => void | Promise<void>;
  isItemPending?: (recurringSeriesKey: number) => boolean;
  className?: string;
}

const isReviewCandidate = (item: ReviewItem) =>
  item.status === "candidate" && item.confidenceScore < 90;

const sortQueueItems = (items: ReviewItem[]) =>
  [...items].sort((left, right) => {
    if (right.occurrenceCount !== left.occurrenceCount) {
      return right.occurrenceCount - left.occurrenceCount;
    }
    return left.displayName.localeCompare(right.displayName);
  });

export function RecurringReviewQueue({
  items,
  currencyCode,
  getCurrencyCode,
  locale,
  labels,
  onConfirm,
  onDismiss,
  isItemPending,
  className,
}: RecurringReviewQueueProps) {
  const orderedItems = sortQueueItems(items.filter(isReviewCandidate));

  if (orderedItems.length === 0) {
    return labels.emptyState ? <>{labels.emptyState}</> : null;
  }

  return (
    <Card className={className}>
      <CardContent className="p-0">
        <ul className="divide-border divide-y">
          {orderedItems.map((item) => {
            const explainability = labels.explainability?.(item);

            return (
              <li
                key={item.recurringSeriesKey}
                className={cn("p-4 md:p-6", labels.itemClassName)}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-medium">
                        {item.displayName}
                      </h3>
                      <RecurringStatusBadge
                        status={item.status}
                        confidenceScore={item.confidenceScore}
                        labels={labels.statusLabels}
                      />
                    </div>

                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      {labels.typeLabels?.[item.type] ? (
                        <span>{labels.typeLabels[item.type]}</span>
                      ) : null}
                      {labels.cadenceLabels?.[item.cadence] ? (
                        <span>{labels.cadenceLabels[item.cadence]}</span>
                      ) : null}
                      {explainability ? <span>{explainability}</span> : null}
                    </div>

                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <RecurringAmountDisplay
                        item={item}
                        currencyCode={
                          getCurrencyCode?.(item) ??
                          currencyCode ??
                          item.currency?.code
                        }
                        locale={locale}
                        className="text-lg"
                      />
                      <span className="text-muted-foreground text-sm">
                        {labels.occurrenceCount?.(item.occurrenceCount) ??
                          new Intl.NumberFormat(locale).format(
                            item.occurrenceCount,
                          )}
                      </span>
                    </div>
                  </div>

                  {(onConfirm || onDismiss) && (
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {onConfirm ? (
                        <Button
                          type="button"
                          size="sm"
                          className="min-h-11 lg:min-h-9"
                          aria-label={labels.confirmActionLabel?.(
                            item.displayName,
                          )}
                          onClick={() => onConfirm(item.recurringSeriesKey)}
                          disabled={isItemPending?.(item.recurringSeriesKey)}
                        >
                          {labels.confirmAction}
                        </Button>
                      ) : null}
                      {onDismiss ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-11 lg:min-h-9"
                          aria-label={labels.dismissActionLabel?.(
                            item.displayName,
                          )}
                          onClick={() => onDismiss(item.recurringSeriesKey)}
                          disabled={isItemPending?.(item.recurringSeriesKey)}
                        >
                          {labels.dismissAction}
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
