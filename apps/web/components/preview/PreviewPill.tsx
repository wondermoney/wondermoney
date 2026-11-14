"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * The small "Preview" tag that marks an entry point to a feature behind the
 * preview-features flag. Same shape as `PreviewBadge` (the sample-data tag), so
 * the two read as one convention rather than two badges.
 */
export function PreviewPill({ className }: { className?: string }) {
  const t = useTranslations();
  return (
    <span
      className={cn(
        "border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs leading-none font-medium",
        className,
      )}
    >
      {t("preview")}
    </span>
  );
}
