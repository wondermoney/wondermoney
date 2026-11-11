"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  RecurringOccurrence,
  RecurringOccurrenceStatus,
} from "@/lib/api/recurring/useRecurringOccurrences";
import { cn } from "@/lib/utils";
import {
  calendarDays,
  dayTotal,
  groupOccurrencesByDay,
  monthLabel,
  shiftMonth,
  weekdayLabels,
} from "@/lib/utils/recurring-calendar";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

export interface RecurringMonthCalendarLabels {
  previousMonth: string;
  nextMonth: string;
  today: string;
  emptyDay: ReactNode;
  loading: ReactNode;
  status: Record<RecurringOccurrenceStatus, string>;
  paymentCount: (count: number) => string;
}

export interface RecurringMonthCalendarProps {
  /** The visible month as `YYYY-MM`. */
  month: string;
  /** The selected day as `YYYY-MM-DD`. */
  selectedDay: string;
  /** Today as `YYYY-MM-DD`, so the grid can mark it without reading the clock. */
  today: string;
  items: readonly RecurringOccurrence[];
  isLoading?: boolean;
  locale?: string;
  labels: RecurringMonthCalendarLabels;
  onSelectDay: (day: string) => void;
  onMonthChange: (month: string) => void;
  onToday: () => void;
  className?: string;
}

const badgeVariants: Record<
  RecurringOccurrenceStatus,
  "destructive" | "muted" | "outline" | "secondary" | "warning"
> = {
  due: "warning",
  overdue: "destructive",
  paid: "secondary",
  projected: "outline",
};

const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

const dayNumber = (day: string) => Number(day.slice(8, 10));

export function RecurringMonthCalendar({
  month,
  selectedDay,
  today,
  items,
  isLoading = false,
  locale,
  labels,
  onSelectDay,
  onMonthChange,
  onToday,
  className,
}: RecurringMonthCalendarProps) {
  const formatMoney = useFormatCurrency();
  const days = calendarDays(month);
  const grouped = groupOccurrencesByDay(items);
  const selectedItems = grouped.get(selectedDay) ?? [];
  const formatDay = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(new Date(`${day}T00:00:00`));
  const selectedLabel = formatDay(selectedDay, {
    day: "numeric",
    month: "long",
    weekday: "long",
  });

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={labels.previousMonth}
            onClick={() => onMonthChange(shiftMonth(month, -1))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <p className="text-sm font-medium">{monthLabel(month, locale)}</p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9"
              onClick={onToday}
            >
              {labels.today}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label={labels.nextMonth}
              onClick={() => onMonthChange(shiftMonth(month, 1))}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="bg-muted/40 text-muted-foreground grid grid-cols-7 border-b text-xs">
          {weekdayLabels(locale).map((weekday) => (
            <span key={weekday} className="px-2 py-2 text-center">
              {weekday}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
          {days.map((day) => {
            const dayItems = grouped.get(day) ?? [];
            const total = dayTotal(dayItems);
            const inMonth = day.slice(0, 7) === month;
            const isSelected = day === selectedDay;
            const isToday = day === today;
            const hasOverdue = dayItems.some((item) => item.status === "overdue");
            const hasDue = dayItems.some((item) => item.status === "due");
            const totalLabel = total.amount !== null && isCurrencyCode(total.currency)
              ? formatMoney(total.amount, total.currency, { maximumFractionDigits: 2 })
              : labels.paymentCount(total.count);

            return (
              <button
                key={day}
                type="button"
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                className={cn(
                  "relative flex min-h-16 flex-col items-start gap-1 border-r border-b p-1.5 text-left transition-colors",
                  "hover:bg-muted/60 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
                  inMonth ? "text-foreground" : "text-muted-foreground/60",
                  isSelected && "bg-primary/10",
                )}
                onClick={() => onSelectDay(day)}
              >
                <span className="flex w-full items-center justify-between">
                  <span
                    className={cn(
                      "font-mono text-xs tabular-nums",
                      isToday && "text-primary font-semibold",
                    )}
                  >
                    {dayNumber(day)}
                  </span>
                  {dayItems.length > 0 ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        hasOverdue
                          ? "bg-destructive-text"
                          : hasDue
                            ? "bg-warning-text"
                            : "bg-primary",
                      )}
                    />
                  ) : null}
                </span>
                {dayItems.length > 0 ? (
                  <span className="text-muted-foreground w-full truncate font-mono text-xs tabular-nums">
                    {totalLabel}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="px-4 py-4">
          <h3 className="text-sm font-medium">{selectedLabel}</h3>
          {isLoading ? (
            <p className="text-muted-foreground mt-2 text-sm">{labels.loading}</p>
          ) : selectedItems.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">{labels.emptyDay}</p>
          ) : (
            <ul className="mt-2">
              {selectedItems.map((item) => (
                <li
                  key={`${item.seriesKey}-${item.date}`}
                  className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm">{item.name}</span>
                    <Badge variant={badgeVariants[item.status]}>
                      {labels.status[item.status]}
                    </Badge>
                  </div>
                  <span className="font-mono text-sm tabular-nums">
                    {item.expectedAmount !== null && isCurrencyCode(item.currency)
                      ? formatMoney(item.expectedAmount, item.currency, {
                          minimumFractionDigits: 2,
                        })
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
