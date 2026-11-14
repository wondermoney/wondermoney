"use client";

import { useTranslations } from "next-intl";

import { InstallmentBadge } from "@/components/installments/InstallmentBadge";
import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import type {
  ForecastInstallment,
  ForecastOccurrence,
} from "@/lib/api/account/useAccountForecast";
import { cn } from "@/lib/utils";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

interface ProjectedTransactionsProps {
  className?: string;
  occurrences: ForecastOccurrence[];
  /** Upcoming card installments, projections too; listed with the recurring ones by date. */
  installments?: ForecastInstallment[];
}

interface ProjectedRow {
  key: string;
  name: string;
  date: string;
  amount: number;
  currency: string;
  installment: ForecastInstallment | null;
}

/** Recurring occurrences and upcoming installments as one date-ordered list. */
export function projectedRows(
  occurrences: readonly ForecastOccurrence[],
  installments: readonly ForecastInstallment[] = [],
): ProjectedRow[] {
  return [
    ...occurrences.map((occurrence) => ({
      key: `${occurrence.seriesKey}-${occurrence.date}`,
      name: occurrence.name,
      date: occurrence.date,
      amount: occurrence.amount,
      currency: occurrence.currency,
      installment: null,
    })),
    ...installments.map((installment) => ({
      key: `installment-${installment.installmentPlanKey}-${installment.installmentNumber}`,
      name: installment.name,
      date: installment.date,
      amount: installment.amount,
      currency: installment.currency,
      installment,
    })),
  ].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * The recurring payments and card installments still to come, above an account's transaction
 * list.
 *
 * These are projections, not transactions: they are rendered outside the ledger (so no filter,
 * selection, edit or total sees them), with a dashed edge and a "Projected" badge. Nothing is
 * created until the person records one.
 */
export default function ProjectedTransactions({
  className,
  occurrences,
  installments,
}: ProjectedTransactionsProps) {
  const t = useTranslations();
  const formatShortDate = useFormatShortDate();
  const rows = projectedRows(occurrences, installments);

  if (rows.length === 0) return null;

  return (
    <section
      aria-label={t("forecast.projectedTransactions")}
      className={cn(
        "border-border bg-muted/20 rounded-lg border border-dashed",
        className,
      )}
    >
      <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed px-4 py-2.5">
        <p className="text-foreground text-sm font-medium">
          {t("forecast.projectedTransactions")}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("forecast.notCounted")}
        </p>
      </div>
      <ul className="divide-border divide-y divide-dashed">
        {rows.map((occurrence) => (
          <li
            key={occurrence.key}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-foreground truncate text-sm font-medium">
                  {occurrence.name}
                </p>
                <InstallmentBadge installment={occurrence.installment} />
              </div>
              <p className="text-muted-foreground text-xs">
                {formatShortDate(
                  transactionDisplayDate(`${occurrence.date}T00:00:00.000Z`),
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="outline"
                className="text-muted-foreground border-dashed text-xs font-normal"
              >
                {t("forecast.projected")}
              </Badge>
              <span className="text-foreground font-mono text-sm font-semibold tabular-nums">
                <Amount
                  value={-occurrence.amount}
                  currency={occurrence.currency}
                />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
