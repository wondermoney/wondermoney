"use client";

import { useLocale, useTranslations } from "next-intl";

import { badgeVariants } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRateDate, type FxView } from "@/lib/fx/fx-status";
import { cn } from "@/lib/utils";

/**
 * Marks one amount that was not converted at a current rate: "Not converted"
 * when there is no rate (the amount beside it is the original one), or
 * "Estimated" when it was converted at an old rate, with that rate's date.
 * Renders nothing for an exact conversion. The badge is focusable, and its
 * tooltip says why.
 */
export function FxStatusBadge({
  view,
  originalCurrency,
  className,
}: {
  view: FxView;
  /** The currency the amount is really in. */
  originalCurrency: string;
  className?: string;
}) {
  const t = useTranslations("fx");
  const locale = useLocale();
  if (view.status === "exact") return null;

  const label = view.status === "missing" ? t("not-converted") : t("estimated");
  const hint =
    view.status === "missing"
      ? t("not-converted-hint", { currency: originalCurrency })
      : view.rateDate
        ? t("estimated-hint", { date: formatRateDate(view.rateDate, locale) })
        : t("estimated-hint-no-date");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={`${label}. ${hint}`}
          onClick={(event) => event.stopPropagation()}
          className={cn("inline-flex", className)}
        >
          <span
            className={cn(
              badgeVariants({
                variant: view.status === "missing" ? "warning" : "muted",
              }),
              "font-sans font-medium whitespace-nowrap",
            )}
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-left">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
