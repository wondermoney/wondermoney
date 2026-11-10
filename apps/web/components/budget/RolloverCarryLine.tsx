"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import type { BudgetRowLike } from "@/lib/budget/rows";
import { cn } from "@/lib/utils";
import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

/**
 * The secondary line under a category's planned amount when last month
 * carried something in: "+€40 from last month" or "−€25 overspent last
 * month". The sign and the words carry the meaning; the overspend's red ink is
 * only a second cue. When the carry rests on spending that could not be
 * converted, an info glyph says it may be too high (visible title, sr-only
 * sentence). Renders nothing when nothing carries.
 */
export function RolloverCarryLine({
  row,
  currency,
  className,
}: {
  row: Pick<BudgetRowLike, "rolledOver"> & { rolloverIncomplete?: boolean };
  currency: SupportedCurrencyCodes;
  className?: string;
}) {
  const t = useTranslations("budgetPage");
  const formatCurrency = useFormatCurrency();
  const rolledOver = row.rolledOver ?? 0;
  if (rolledOver === 0) return null;

  const overspent = rolledOver < 0;
  const amount = formatCurrency(Math.abs(rolledOver), currency);
  const incompleteNote = t("rollover-incomplete");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-sans text-xs whitespace-nowrap",
        overspent ? "text-destructive-text" : "text-muted-foreground",
        className,
      )}
    >
      <span>
        {t.rich(overspent ? "rolled-over-overspend" : "rolled-over-surplus", {
          amount,
          money: (chunks) => <span className="font-mono">{chunks}</span>,
        })}
      </span>
      {row.rolloverIncomplete ? (
        <span
          className="text-muted-foreground inline-flex"
          title={incompleteNote}
        >
          <Info className="size-3.5" aria-hidden="true" focusable="false" />
          <span className="sr-only">{incompleteNote}</span>
        </span>
      ) : null}
    </span>
  );
}
