"use client";

import { useTranslations } from "next-intl";

import { MultiSelect } from "./MultiSelect";

interface TagMultiSelectProps {
  tags: Array<{ key: string; name: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
}

/** Report filter by household tag; a transaction counts when it carries any selected tag. */
export function TagMultiSelect({
  tags,
  selected,
  onChange,
  className,
}: TagMultiSelectProps) {
  const t = useTranslations("reports.filters");

  return (
    <MultiSelect
      label={t("tags")}
      options={tags.map((tag) => ({ value: tag.key, label: tag.name }))}
      selected={selected}
      onChange={onChange}
      placeholder={t("placeholder.allTags")}
      className={className}
    />
  );
}
