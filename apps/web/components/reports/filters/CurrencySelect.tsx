"use client";

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";

interface CurrencySelectProps {
  currencies: Array<{ key: string; name: string }>;
  value?: string;
  onChange: (value: string | undefined) => void;
  className?: string;
}

export function CurrencySelect({
  currencies,
  value,
  onChange,
  className,
}: CurrencySelectProps) {
  const t = useTranslations("reports.filters");

  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => onChange(next || undefined)}
    >
      <SelectTrigger className={className} aria-label={t("currency")}>
        <SelectValue placeholder={t("placeholder.allCurrencies")} />
      </SelectTrigger>
      <SelectContent>
        {currencies.map((currency) => (
          <SelectItem key={currency.key} value={currency.key}>
            {currency.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
