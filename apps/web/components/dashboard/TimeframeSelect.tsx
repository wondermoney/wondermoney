"use client";

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
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={t("timeframe")} />
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
