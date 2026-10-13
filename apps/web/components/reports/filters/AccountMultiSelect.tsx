"use client";

import { useTranslations } from "next-intl";

import { MultiSelect } from "./MultiSelect";

interface AccountMultiSelectProps {
  accounts: Array<{ key: string; name: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

export function AccountMultiSelect({
  accounts,
  selected,
  onChange,
  className,
}: AccountMultiSelectProps) {
  const t = useTranslations("reports.filters");

  return (
    <MultiSelect
      label={t("accounts")}
      options={accounts.map((account) => ({
        value: account.key,
        label: account.name,
      }))}
      selected={selected}
      onChange={onChange}
      placeholder={t("placeholder.search")}
      className={className}
    />
  );
}
