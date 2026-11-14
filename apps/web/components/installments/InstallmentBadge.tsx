"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { TransactionInstallment } from "@/lib/api/installment-plans/types";
import { cn } from "@/lib/utils";

export const installmentPlanHref = (installmentPlanKey: number) =>
  `/accounts/installment-plans/${installmentPlanKey}`;

/**
 * "3/12" beside a transaction that is one installment of a plan, linking to the plan. A calm
 * status chip, like the recurring and transfer badges: it says what the row is, nothing more.
 * Renders nothing for an ordinary row.
 */
export function InstallmentBadge({
  installment,
  className,
}: {
  installment: TransactionInstallment | null | undefined;
  className?: string;
}) {
  const t = useTranslations();
  if (!installment) return null;

  const label = t("installments.badge-label", {
    number: installment.installmentNumber,
    count: installment.installmentCount,
  });

  return (
    <Link
      href={installmentPlanHref(installment.installmentPlanKey)}
      className={cn(
        "border-input bg-secondary text-muted-foreground hover:text-foreground ring-offset-background focus-visible:ring-ring inline-flex h-5 shrink-0 items-center rounded-full border px-2 font-mono text-xs tabular-nums no-underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {installment.installmentNumber}/{installment.installmentCount}
    </Link>
  );
}
