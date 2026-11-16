"use client";

import { CalendarRange } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";

type Props = {
  timeframe: string;
  timeframes: { label: string; value: string }[];
  setTimeframe: (timeframe: string) => void;
};

export default function TimeframeSelect({
  timeframe,
  timeframes,
  setTimeframe,
}: Props) {
  const t = useTranslations();

  return (
    <Select value={timeframe} onValueChange={setTimeframe}>
      <SelectTrigger
        aria-label={`${t("timeframe")}: ${timeframes.find((option) => option.value === timeframe)?.label ?? timeframe}`}
        title={timeframes.find((option) => option.value === timeframe)?.label}
        className="w-[180px] max-sm:size-11 max-sm:w-11 max-sm:justify-center max-sm:border-transparent max-sm:p-0 max-sm:[&>svg:last-child]:hidden"
      >
        <CalendarRange className="size-4 sm:hidden" aria-hidden="true" />
        <span className="max-sm:sr-only">
          <SelectValue placeholder={t("timeframe")} />
        </span>
      </SelectTrigger>
      <SelectContent>
        {timeframes.map((timeframe) => (
          <SelectItem key={timeframe.value} value={timeframe.value}>
            {timeframe.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
