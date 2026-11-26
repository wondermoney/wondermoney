"use client";

import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * "Balance as of 12 Nov 2026", under a bank account's balance while that balance is derived from
 * its transactions because the bank sent none (`balanceDerivedAt`). The date is `refreshedAt`, the
 * last time the bank itself confirmed the balance. Renders nothing while the balance is the
 * bank's own figure, or when there is no valid date to give. Small and muted, with no icon: it
 * qualifies the figure above it, it is not a warning.
 */
export function BalanceAsOf({
  balanceDerivedAt,
  refreshedAt,
  className,
}: {
  balanceDerivedAt?: string | null;
  refreshedAt: string | null;
  className?: string;
}) {
  const t = useTranslations();
  const format = useFormatter();
  if (!balanceDerivedAt || !refreshedAt) return null;
  const confirmedAt = new Date(refreshedAt);
  if (Number.isNaN(confirmedAt.getTime())) return null;
  return (
    <p
      className={cn("text-muted-foreground text-xs", className)}
      data-testid="balance-as-of"
    >
      {t("balance-as-of", {
        date: format.dateTime(confirmedAt, { dateStyle: "medium" }),
      })}
    </p>
  );
}

export default BalanceAsOf;
