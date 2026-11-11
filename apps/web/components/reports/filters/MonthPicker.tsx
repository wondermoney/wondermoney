"use client";

import { endOfMonth, startOfMonth } from "date-fns";
import { useLocale } from "next-intl";

import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";

/**
 * A calendar month (`YYYY-MM`) picker for the month-comparison report.
 *
 * The report compares two named months rather than the page's shared date
 * range, so it owns its own two pickers. A month is a floating calendar label,
 * never an instant: the API turns it into the month's range in the viewer's
 * time zone.
 */

/** How far back the picker offers months. */
export const MONTH_PICKER_MONTHS = 36;

/** `YYYY-MM` for a date, read in the browser's calendar. */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

/** `monthKey` moved by `delta` months (negative moves back). */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  const shifted = new Date(year, month - 1 + delta, 1);
  return monthKeyOf(shifted);
}

/** The whole days a `YYYY-MM` month covers, as the transaction list wants them. */
export function monthKeyDateRange(monthKey: string): {
  fromDate: string;
  toDate: string;
} {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  const first = new Date(year, month - 1, 1);
  return {
    fromDate: startOfMonth(first).toISOString(),
    toDate: endOfMonth(first).toISOString(),
  };
}

/** "August 2026", in the viewer's language. */
export function formatMonthLabel(monthKey: string, locale: string): string {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(Date.UTC(year, month - 1, 1)));
  } catch {
    return monthKey;
  }
}

/** The months the picker offers: the last {@link MONTH_PICKER_MONTHS}, newest first. */
export function monthPickerOptions(now: Date = new Date()): string[] {
  const current = monthKeyOf(now);
  return Array.from({ length: MONTH_PICKER_MONTHS }, (_, index) =>
    shiftMonthKey(current, -index),
  );
}

interface MonthPickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (monthKey: string) => void;
  /** Extra months to offer, e.g. a deep-linked month older than the window. */
  extraMonths?: string[];
  className?: string;
}

export function MonthPicker({
  id,
  label,
  value,
  onChange,
  extraMonths = [],
  className,
}: MonthPickerProps) {
  const locale = useLocale();
  const options = [...new Set([...monthPickerOptions(), value, ...extraMonths])]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  return (
    <div className={className}>
      <Label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label} className="mt-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((monthKey) => (
            <SelectItem key={monthKey} value={monthKey}>
              {formatMonthLabel(monthKey, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
