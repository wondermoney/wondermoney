"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import type { LoanDetail, LoanRepayment } from "@/lib/api/loan/types";

export default function LoanAmortizationPreview({
  loan,
}: {
  loan: LoanDetail;
  repayments: LoanRepayment[];
}) {
  const t = useTranslations("loans");
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium">
          {t("detail.amortization.title")}
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          {t("detail.amortization.unavailable")}
        </p>
      </CardContent>
    </Card>
  );
}
