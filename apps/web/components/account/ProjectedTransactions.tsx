"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import type { ForecastOccurrence } from "@/lib/api/account/useAccountForecast";
import { cn } from "@/lib/utils";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

interface ProjectedTransactionsProps {
  className?: string;
  occurrences: ForecastOccurrence[];
}

/**
 * The recurring payments still to come, above an account's transaction list.
 *
 * These are projections, not transactions: they are rendered outside the ledger (so no filter,
 * selection, edit or total sees them), with a dashed edge and a "Projected" badge. Nothing is
 * created until the person records one.
 */
export default function ProjectedTransactions({
  className,
  occurrences,
}: ProjectedTransactionsProps) {
  const t = useTranslations();
  const formatShortDate = useFormatShortDate();

  if (occurrences.length === 0) return null;

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
        {occurrences.map((occurrence) => (
          <li
            key={`${occurrence.seriesKey}-${occurrence.date}`}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-medium">
                {occurrence.name}
              </p>
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
