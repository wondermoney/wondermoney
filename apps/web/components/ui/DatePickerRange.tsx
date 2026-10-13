"use client";

import {
  endOfMonth,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { useLocale,useTranslations } from "next-intl";
import { DateRange, type SelectRangeEventHandler } from "react-day-picker";

import { Calendar } from "@/components/ui/Calendar";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface DatePickerWithRangeProps {
  value?: DateRange;
  onSelect: SelectRangeEventHandler;
}

const DatePickerWithRange: React.FC<DatePickerWithRangeProps> = ({
  value,
  onSelect,
}) => {
  const t = useTranslations();
  // RAD-575 — the reader's calendar, not the runtime's.
  const locale = useLocale();
  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);

  /*
   * A preset rail beside the calendar. § 9 DateRangePopover.
   *
   * Picking "the last 30 days" through a two-month grid means finding today,
   * counting backwards across a month boundary, and clicking twice — for a
   * range the user could name in three words. The reference puts the named
   * ranges first and keeps the grid for the cases that have no name.
   *
   * Presets apply immediately, like a calendar click, so there is no Apply
   * step to forget.
   */
  const today = new Date();
  const presets: { labelKey: string; range: DateRange }[] = [
    {
      labelKey: "date-preset-last-7-days",
      range: { from: subDays(today, 6), to: today },
    },
    {
      labelKey: "date-preset-last-30-days",
      range: { from: subDays(today, 29), to: today },
    },
    {
      labelKey: "date-preset-month-to-date",
      range: { from: startOfMonth(today), to: today },
    },
    {
      labelKey: "date-preset-last-3-months",
      range: { from: startOfMonth(subMonths(today, 2)), to: endOfMonth(today) },
    },
    {
      labelKey: "date-preset-year-to-date",
      range: { from: startOfYear(today), to: today },
    },
    {
      labelKey: "date-preset-last-12-months",
      range: {
        from: startOfMonth(subMonths(today, 11)),
        to: endOfMonth(today),
      },
    },
  ];

  const isActivePreset = (range: DateRange) =>
    Boolean(
      value?.from &&
      value?.to &&
      range.from &&
      range.to &&
      value.from.toDateString() === range.from.toDateString() &&
      value.to.toDateString() === range.to.toDateString(),
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id="date"
          variant="secondary"
          // `sm`, matching the page actions above it. The toolbar used to mix
          // two heights — 36px for Import/Add and 40px here and on Filters —
          // with 12px and 16px of padding, so four controls in one header sat
          // at two sizes.
          size="sm"
          className={cn(
            "w-[270px] justify-start text-left font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 size-4 shrink-0" />
          {value?.from ? (
            value.to ? (
              <>
                {formatDate(value.from)} - {formatDate(value.to)}
              </>
            ) : (
              formatDate(value.from)
            )
          ) : (
            <span>{t("pick-date")}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          <div className="border-border flex shrink-0 flex-col gap-0.5 border-b p-2 sm:border-r sm:border-b-0">
            {presets.map((preset) => (
              <Button
                key={preset.labelKey}
                variant="ghost"
                size="sm"
                className={cn(
                  "justify-start font-normal",
                  isActivePreset(preset.range) &&
                    "bg-accent text-accent-foreground font-medium",
                )}
                onClick={() =>
                  // react-day-picker's handler signature expects the
                  // originating day click; a preset has none, so the range
                  // itself is what matters and the rest is filled to satisfy
                  // the type.
                  onSelect?.(
                    preset.range,
                    preset.range.from as Date,
                    {},
                    {} as never,
                  )
                }
              >
                {t(preset.labelKey)}
              </Button>
            ))}
          </div>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={value?.from}
            selected={value}
            onSelect={onSelect}
            numberOfMonths={2}
            startMonth={new Date(2000, 0, 1)}
            endMonth={new Date(2100, 11, 31)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DatePickerWithRange;
