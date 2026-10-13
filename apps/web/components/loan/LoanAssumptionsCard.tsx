"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import type { LoanDetail } from "@/lib/api/loan/types";
import {
  LOAN_STATUS_LABEL_KEY,
  LOAN_TYPE_LABEL_KEY,
} from "@/lib/loans/loan-labels";

export default function LoanAssumptionsCard({ loan }: { loan: LoanDetail }) {
  const t = useTranslations("loans");
  const rows = [
    [t("fields.lender"), t("detail.providerUnavailable")],
    [t("fields.type"), t(`types.${LOAN_TYPE_LABEL_KEY[loan.type] ?? "other"}`)],
    [
      t("fields.status"),
      t(`statuses.${LOAN_STATUS_LABEL_KEY[loan.status] ?? "active"}`),
    ],
    [t("detail.description"), loan.description ?? loan.notes ?? t("detail.na")],
  ] as const;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="text-sm font-medium">
          {t("detail.assumptions.title")}
        </div>
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-start justify-between gap-4 text-sm"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="text-right">{value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
