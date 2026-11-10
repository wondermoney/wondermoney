"use client";

import { useTranslations } from "next-intl";

import { Section } from "@/components/ui/RuledSection";
import type { LoanDetail, LoanRepayment } from "@/lib/api/loan/types";

export default function LoanAmortizationPreview({}: {
  loan: LoanDetail;
  repayments: LoanRepayment[];
}) {
  const t = useTranslations("loans");
  return (
    <Section
      id="loan-amortization-heading"
      title={t("detail.amortization.title")}
    >
      <p className="text-muted-foreground text-sm">
        {t("detail.amortization.unavailable")}
      </p>
    </Section>
  );
}
