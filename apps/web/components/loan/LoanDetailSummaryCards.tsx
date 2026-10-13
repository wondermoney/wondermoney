"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import LoanProgressIndicator from "@/components/loan/LoanProgressIndicator";
import { Amount } from "@/components/ui/Amount";
import { Card, CardContent } from "@/components/ui/card";
import type { LoanDetail } from "@/lib/api/loan/types";

export default function LoanDetailSummaryCards({
  loan,
  summary,
}: {
  loan: LoanDetail;
  summary: {
    outstanding: number;
    payment: number;
    rate: number;
    remaining: number | null;
    progress: number;
  };
}) {
  const t = useTranslations("loans");
  /*
   * Outstanding principal is deliberately absent here — it is the loan's key
   * figure and now sits in `ObjectHeader` with the title. § 9: one header
   * carries the identity and the number, rather than naming the object and
   * boxing its number third on the page.
   */
  const items: { label: string; value: ReactNode }[] = [
    {
      label: t("summary.regularPayment"),
      value: <Amount value={summary.payment} currency={loan.currency.code} />,
    },
    {
      label: t("summary.annualRate"),
      value: summary.rate
        ? `${(summary.rate / 100).toFixed(2)}%`
        : t("detail.na"),
    },
    {
      label: t("summary.remainingTerm"),
      value:
        summary.remaining !== null
          ? t("detail.months", { count: summary.remaining })
          : t("detail.na"),
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {items.map(({ label, value }) => (
        <Card key={label}>
          <CardContent className="p-4">
            <div className="text-muted-foreground text-sm">{label}</div>
            <div className="mt-2 font-mono text-xl font-semibold">{value}</div>
          </CardContent>
        </Card>
      ))}
      <Card className="md:col-span-2 xl:col-span-1">
        <CardContent className="p-4">
          <div className="text-muted-foreground text-sm">
            {t("summary.progress")}
          </div>
          <div className="mt-2 font-mono text-xl font-semibold">
            {summary.progress.toFixed(0)}%
          </div>
          <LoanProgressIndicator
            value={summary.progress}
            label={t("summary.progressLabel", {
              value: summary.progress.toFixed(0),
            })}
            className="mt-3"
          />
        </CardContent>
      </Card>
    </div>
  );
}
