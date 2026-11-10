"use client";

import { useLocale, useTranslations } from "next-intl";

import type { AmountsCompleteness } from "@/lib/api/completeness";
import { cn } from "@/lib/utils";

/**
 * Says that a total leaves rows out because their currency has no exchange
 * rate yet, so a partial total never reads as a whole one. Renders nothing
 * when the total is complete or the API sent no completeness.
 */
export function UnconvertedAmountsNotice({
  completeness,
  className,
}: {
  completeness: AmountsCompleteness | undefined;
  className?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  if (!completeness || completeness.isComplete) return null;

  const currencies = completeness.unconvertedCurrencies ?? [];
  const message =
    currencies.length > 0
      ? t("unconverted-amounts", {
          count: completeness.unconvertedTransactions,
          currencies: new Intl.ListFormat(locale, {
            style: "long",
            type: "conjunction",
          }).format(currencies),
        })
      : t("unconverted-amounts-no-currency", {
          count: completeness.unconvertedTransactions,
        });

  return (
    <p role="note" className={cn("text-muted-foreground text-sm", className)}>
      {message}
    </p>
  );
}
