"use client";

import { useTranslations } from "next-intl";

import { StatCard, StatCardGrid } from "@/components/ui/StatCard";

type Props = {
  currencyCode: string;
  totalOutstandingAmount: number;
  monthlyRepaymentTotal: number;
  interestAndFeesThisMonth: number;
  netWorthImpact: number;
  netWorthImpactLabel?: string;
  repaymentsNeedingReview: number;
};

export default function LoansSummaryCards({
  currencyCode,
  totalOutstandingAmount,
  monthlyRepaymentTotal,
  interestAndFeesThisMonth,
  netWorthImpact,
  netWorthImpactLabel,
  repaymentsNeedingReview,
}: Props) {
  const t = useTranslations("loans");

  const cards = [
    { label: t("summary.totalOutstanding"), value: totalOutstandingAmount },
    { label: t("summary.monthlyRepayment"), value: monthlyRepaymentTotal },
    { label: t("summary.interestAndFees"), value: interestAndFeesThisMonth },
    {
      label: t("summary.netWorthImpact"),
      value: netWorthImpact,
      labelOverride: netWorthImpactLabel,
    },
    ...(repaymentsNeedingReview > 0
      ? [
          {
            label: t("summary.repaymentsNeedingReview"),
            value: repaymentsNeedingReview,
            isCount: true,
          },
        ]
      : []),
  ] as Array<{
    label: string;
    value: number;
    isCount?: boolean;
    labelOverride?: string;
  }>;

  return (
    // On `StatCard` rather than a bespoke card so these inherit § 9 rules 3, 5
    // and 6 — em-dash for absence, room for a comparison, and a helper line for
    // provenance — instead of reimplementing a subset of them.
    <StatCardGrid className="md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <StatCard
          key={card.label}
          label={card.label}
          {...(card.labelOverride !== undefined
            ? { valueNode: card.labelOverride }
            : card.isCount
              ? {
                  valueNode: (
                    <span className="font-mono text-xl font-semibold tracking-tight tabular-nums">
                      {card.value}
                    </span>
                  ),
                }
              : { value: card.value, currency: currencyCode })}
        />
      ))}
    </StatCardGrid>
  );
}
