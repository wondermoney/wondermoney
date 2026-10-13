"use client";

import { useTranslations } from "next-intl";

import { MultiSelect } from "./MultiSelect";

interface CategoryMultiSelectProps {
  categories: Array<{ key: string; name: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

export function CategoryMultiSelect({
  categories,
  selected,
  onChange,
  className,
}: CategoryMultiSelectProps) {
  const t = useTranslations("reports.filters");

  return (
    <MultiSelect
      label={t("categories")}
      options={categories.map((category) => ({
        value: category.key,
        label: category.name,
      }))}
      selected={selected}
      onChange={onChange}
      placeholder={t("placeholder.search")}
      className={className}
    />
  );
}
