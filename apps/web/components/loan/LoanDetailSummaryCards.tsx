"use client";

import { useTranslations } from "next-intl";

import LoanProgressIndicator from "@/components/loan/LoanProgressIndicator";
import { Amount } from "@/components/ui/Amount";
import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import type { LoanDetail } from "@/lib/api/loan/types";
import type { LoanSummary } from "@/lib/loans/loan-summary";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

/**
 * The loan's terms as a ruled stat row. Outstanding principal is not here:
 * it is the loan's figure and sits in the header with its name.
 */
export default function LoanDetailSummaryCards({
  loan,
  summary,
}: {
  loan: LoanDetail;
  summary: LoanSummary;
}) {
  const t = useTranslations("loans");
  const formatPercentage = useFormatPercentage();
  const figure = "text-foreground text-2xl font-medium tracking-tight";

  return (
    <StatCardGrid className="sm:grid-cols-2 lg:grid-cols-4 lg:divide-y-0">
      <StatCard
        label={t("summary.regularPayment")}
        value={summary.payment}
        valueNode={
          <Amount
            value={summary.payment}
            currency={loan.currency.code}
            className={`font-mono ${figure}`}
          />
        }
      />
      <StatCard
        label={t("summary.annualRate")}
        value={null}
        valueNode={
          <span className={`font-mono ${figure}`}>
            {summary.rate
              ? formatPercentage(summary.rate / 10000, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : t("detail.na")}
          </span>
        }
      />
      <StatCard
        label={t("summary.remainingTerm")}
        value={null}
        valueNode={
          // A count with its unit in words: tabular figures, the body face.
          <span className={`tabular-nums ${figure}`}>
            {summary.remaining !== null
              ? t("detail.months", { count: summary.remaining })
              : t("detail.na")}
          </span>
        }
      />
      <StatCard
        label={t("summary.progress")}
        value={null}
        valueNode={
          <span className={`font-mono ${figure}`}>
            {formatPercentage(summary.progress / 100)}
          </span>
        }
        helper={
          <LoanProgressIndicator
            value={summary.progress}
            label={t("summary.progressLabel", {
              value: Math.round(summary.progress),
            })}
            className="mt-2"
          />
        }
      />
    </StatCardGrid>
  );
}
