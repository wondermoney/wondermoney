"use client";

import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import type { RecurringItem } from "@/lib/api/recurring/useRecurringItems";
import { cn } from "@/lib/utils";

import { RecurringAmountDisplay } from "./RecurringAmountDisplay";
import { RecurringItemActions } from "./RecurringItemActions";
import {
  RecurringStatusBadge,
  type RecurringStatusBadgeLabels,
} from "./RecurringStatusBadge";

export interface RecurringItemsTableLabels {
  merchant: ReactNode;
  type: ReactNode;
  amount: ReactNode;
  frequency: ReactNode;
  nextExpected: ReactNode;
  lastPaid: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  confirmAction?: ReactNode;
  dismissAction?: ReactNode;
  markNotRecurringAction?: ReactNode;
  restoreAction?: ReactNode;
  confirmActionLabel?: (merchant: string) => string;
  dismissActionLabel?: (merchant: string) => string;
  markNotRecurringActionLabel?: (merchant: string) => string;
  restoreActionLabel?: (merchant: string) => string;
  emptyState?: ReactNode;
  typeLabels: Record<RecurringItem["type"], ReactNode>;
  cadenceLabels: Record<RecurringItem["cadence"], ReactNode>;
  statusLabels: RecurringStatusBadgeLabels;
  dateFormatter?: (date: Date) => string;
  expectedAround?: ReactNode;
}

export interface RecurringItemsTableProps {
  items: RecurringItem[];
  currencyCode?: string;
  getCurrencyCode?: (item: RecurringItem) => string | undefined;
  getCategoryLabel?: (item: RecurringItem) => ReactNode;
  locale?: string;
  labels: RecurringItemsTableLabels;
  onConfirm?: (recurringSeriesKey: number) => void | Promise<void>;
  onDismiss?: (recurringSeriesKey: number) => void | Promise<void>;
  onRestore?: (recurringSeriesKey: number) => void | Promise<void>;
  className?: string;
  isItemPending?: (recurringSeriesKey: number) => boolean;
}

const defaultDateFormatter = (date: Date, locale?: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);

const sortByNextExpected = (items: RecurringItem[]) =>
  [...items].sort((left, right) => {
    const leftTime = left.nextExpectedAt
      ? new Date(left.nextExpectedAt).getTime()
      : Number.POSITIVE_INFINITY;
    const rightTime = right.nextExpectedAt
      ? new Date(right.nextExpectedAt).getTime()
      : Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });

const formatDateValue = (
  value: string | null | undefined,
  formatter: (date: Date) => string,
) => {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : formatter(date);
};

export function RecurringItemsTable({
  items,
  currencyCode,
  getCurrencyCode,
  getCategoryLabel,
  locale,
  labels,
  onConfirm,
  onDismiss,
  onRestore,
  className,
  isItemPending,
}: RecurringItemsTableProps) {
  const orderedItems = sortByNextExpected(items);
  const dateFormatter =
    labels.dateFormatter ??
    ((date: Date) => defaultDateFormatter(date, locale));

  if (orderedItems.length === 0) {
    return labels.emptyState ? <>{labels.emptyState}</> : null;
  }

  return (
    <Card className={className}>
      <CardContent className="p-0">
        <div className="hidden 2xl:block">
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="bg-muted/30 text-muted-foreground border-b text-left text-xs tracking-wide">
                <tr>
                  <th className="px-4 py-3 font-medium">{labels.merchant}</th>
                  <th className="px-4 py-3 font-medium">{labels.type}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {labels.amount}
                  </th>
                  <th className="px-4 py-3 font-medium">{labels.frequency}</th>
                  <th className="px-4 py-3 font-medium">
                    {labels.nextExpected}
                  </th>
                  <th className="px-4 py-3 font-medium">{labels.lastPaid}</th>
                  <th className="px-4 py-3 font-medium">{labels.status}</th>
                  {onConfirm || onDismiss || onRestore ? (
                    <th className="bg-muted/30 sticky right-0 px-4 py-3 text-right font-medium">
                      {labels.actions}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {orderedItems.map((item) => (
                  <tr
                    key={item.recurringSeriesKey}
                    className="border-b last:border-b-0"
                  >
                    <td className="px-4 py-4 align-top">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {item.displayName}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {getCategoryLabel?.(item) ??
                            item.category?.name ??
                            "—"}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted-foreground px-4 py-4 align-top">
                      {labels.typeLabels[item.type]}
                    </td>
                    <td className="px-4 py-4 text-right align-top">
                      <RecurringAmountDisplay
                        item={item}
                        currencyCode={
                          getCurrencyCode?.(item) ??
                          currencyCode ??
                          item.currency?.code
                        }
                        locale={locale}
                      />
                    </td>
                    <td className="text-muted-foreground px-4 py-4 align-top">
                      {labels.cadenceLabels[item.cadence]}
                    </td>
                    <td className="text-muted-foreground px-4 py-4 align-top">
                      <div className="space-y-1">
                        <div className="font-mono whitespace-nowrap tabular-nums">
                          {formatDateValue(item.nextExpectedAt, dateFormatter)}
                        </div>
                        {labels.expectedAround && item.nextExpectedAt ? (
                          <div className="text-xs">{labels.expectedAround}</div>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-muted-foreground px-4 py-4 align-top">
                      <div className="font-mono whitespace-nowrap tabular-nums">
                        {formatDateValue(item.lastSeenAt, dateFormatter)}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <RecurringStatusBadge
                        status={item.status}
                        confidenceScore={item.confidenceScore}
                        labels={labels.statusLabels}
                      />
                    </td>
                    {onConfirm || onDismiss || onRestore ? (
                      <td className="bg-card sticky right-0 px-4 py-4 align-top">
                        <div className="flex justify-end gap-2">
                          <RecurringItemActions
                            status={item.status}
                            recurringSeriesKey={item.recurringSeriesKey}
                            pending={
                              isItemPending?.(item.recurringSeriesKey) ?? false
                            }
                            confirmLabel={labels.confirmAction}
                            dismissLabel={labels.dismissAction}
                            markNotRecurringLabel={
                              labels.markNotRecurringAction
                            }
                            restoreLabel={labels.restoreAction}
                            confirmAriaLabel={labels.confirmActionLabel?.(
                              item.displayName,
                            )}
                            dismissAriaLabel={labels.dismissActionLabel?.(
                              item.displayName,
                            )}
                            markNotRecurringAriaLabel={labels.markNotRecurringActionLabel?.(
                              item.displayName,
                            )}
                            restoreAriaLabel={labels.restoreActionLabel?.(
                              item.displayName,
                            )}
                            onConfirm={onConfirm}
                            onDismiss={onDismiss}
                            onRestore={onRestore}
                          />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="divide-border divide-y 2xl:hidden">
          {orderedItems.map((item) => (
            <div key={item.recurringSeriesKey} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="truncate font-medium">{item.displayName}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {getCategoryLabel?.(item) ?? item.category?.name ?? "—"}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RecurringStatusBadge
                      status={item.status}
                      confidenceScore={item.confidenceScore}
                      labels={labels.statusLabels}
                    />
                    <span className="text-muted-foreground text-sm">
                      {labels.typeLabels[item.type]}
                    </span>
                  </div>
                </div>
                <RecurringAmountDisplay
                  item={item}
                  currencyCode={
                    getCurrencyCode?.(item) ??
                    currencyCode ??
                    item.currency?.code
                  }
                  locale={locale}
                  className="text-sm"
                />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs tracking-wide">
                    {labels.frequency}
                  </dt>
                  <dd className="mt-1">{labels.cadenceLabels[item.cadence]}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs tracking-wide">
                    {labels.nextExpected}
                  </dt>
                  <dd className="mt-1 space-y-1">
                    <div className="font-mono tabular-nums">
                      {formatDateValue(item.nextExpectedAt, dateFormatter)}
                    </div>
                    {labels.expectedAround && item.nextExpectedAt ? (
                      <div className="text-muted-foreground text-xs">
                        {labels.expectedAround}
                      </div>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs tracking-wide">
                    {labels.lastPaid}
                  </dt>
                  <dd className="mt-1 font-mono tabular-nums">
                    {formatDateValue(item.lastSeenAt, dateFormatter)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs tracking-wide">
                    {labels.merchant}
                  </dt>
                  <dd className="mt-1 truncate">{item.displayName}</dd>
                </div>
              </dl>

              {onConfirm || onDismiss || onRestore ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <RecurringItemActions
                    status={item.status}
                    recurringSeriesKey={item.recurringSeriesKey}
                    pending={isItemPending?.(item.recurringSeriesKey) ?? false}
                    confirmLabel={labels.confirmAction}
                    dismissLabel={labels.dismissAction}
                    markNotRecurringLabel={labels.markNotRecurringAction}
                    restoreLabel={labels.restoreAction}
                    confirmAriaLabel={labels.confirmActionLabel?.(
                      item.displayName,
                    )}
                    dismissAriaLabel={labels.dismissActionLabel?.(
                      item.displayName,
                    )}
                    markNotRecurringAriaLabel={labels.markNotRecurringActionLabel?.(
                      item.displayName,
                    )}
                    restoreAriaLabel={labels.restoreActionLabel?.(
                      item.displayName,
                    )}
                    onConfirm={onConfirm}
                    onDismiss={onDismiss}
                    onRestore={onRestore}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
