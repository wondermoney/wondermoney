"use client";

import { format } from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/Calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  ALL_TIME_START,
  type DateRangePreset,
  type DateRangeValue,
  detectPresetForRange,
  getPresetDateRange,
} from "./useReportFilters";

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  className?: string;
}

export function DateRangePicker({
  value,
  onChange,
  className,
}: DateRangePickerProps) {
  const t = useTranslations("reports.filters");
  const [isOpen, setIsOpen] = useState(false);

  const presets: { value: DateRangePreset; label: string }[] = [
    { value: "last3Months", label: t("preset.last3Months") },
    { value: "thisMonth", label: t("preset.thisMonth") },
    { value: "lastMonth", label: t("preset.lastMonth") },
    { value: "last6Months", label: t("preset.last6Months") },
    { value: "last12Months", label: t("preset.last12Months") },
    { value: "allTime", label: t("preset.allTime") },
  ];

  const activePreset = detectPresetForRange(value);
  const displayLabel =
    activePreset === "custom"
      ? `${format(value.from, "dd MMM yyyy")} - ${format(value.to, "dd MMM yyyy")}`
      : t(`preset.${activePreset}` as const);

  const handlePreset = (preset: DateRangePreset) => {
    onChange(getPresetDateRange(preset));
    if (preset !== "allTime") {
      setIsOpen(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-10 justify-start gap-2 px-3 text-left font-normal sm:h-9",
            className,
          )}
          aria-label={t("dateRange")}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col gap-3 p-3 sm:flex-row">
          <div className="flex flex-col gap-1 border-b pb-2 sm:w-40 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3">
            <span className="text-muted-foreground px-2 py-1 text-xs font-medium">
              {t("dateRange")}
            </span>
            {presets.map((preset) => (
              <Button
                key={preset.value}
                variant={activePreset === preset.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => handlePreset(preset.value)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={value.from}
            startMonth={ALL_TIME_START}
            endMonth={new Date()}
            selected={{ from: value.from, to: value.to }}
            onSelect={(range) => {
              if (range?.from && range?.to) {
                onChange({ from: range.from, to: range.to });
              }
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
