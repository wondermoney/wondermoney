"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * A fee the API could not convert to the user's currency is counted as zero
 * (`feeConversionIncomplete` on a holding, `feeConversionIncompleteAssetKeys`
 * on a dashboard summary). Says so next to the figure it affects; the icon
 * shape and the words carry the state, not the amber alone.
 */
export function FeeConversionNotice({
  scope,
  className,
}: {
  scope: "holding" | "gains";
  className?: string;
}) {
  const t = useTranslations();
  return (
    <p
      role="note"
      className={cn(
        "text-warning-text flex items-start gap-1.5 text-xs leading-5",
        className,
      )}
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {scope === "holding"
          ? t("fee-conversion-incomplete-holding")
          : t("fee-conversion-incomplete-gains")}
      </span>
    </p>
  );
}

/** Compact table-cell form: a short visible label, the full sentence for screen readers and on hover. */
export function FeeConversionMarker() {
  const t = useTranslations();
  const description = t("fee-conversion-incomplete-holding");
  return (
    <span
      title={description}
      className="border-warning-text/30 bg-background text-warning-text inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap"
    >
      <AlertTriangle aria-hidden="true" className="size-3" />
      <span aria-hidden="true">
        {t("fee-conversion-incomplete-holding-label")}
      </span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
