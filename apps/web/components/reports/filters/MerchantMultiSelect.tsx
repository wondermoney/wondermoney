"use client";

import { useTranslations } from "next-intl";

import { MultiSelect } from "./MultiSelect";

interface MerchantMultiSelectProps {
  merchants: Array<{ key: string; name: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

export function MerchantMultiSelect({
  merchants,
  selected,
  onChange,
  className,
}: MerchantMultiSelectProps) {
  const t = useTranslations("reports.filters");

  return (
    <MultiSelect
      label={t("merchants")}
      options={merchants.map((merchant) => ({
        value: merchant.key,
        label: merchant.name,
      }))}
      selected={selected}
      onChange={onChange}
      placeholder={t("placeholder.search")}
      className={className}
    />
  );
}
