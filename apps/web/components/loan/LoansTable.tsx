"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import LoanProgressIndicator from "@/components/loan/LoanProgressIndicator";
import { Amount } from "@/components/ui/Amount";
import { Table } from "@/components/ui/Table";
import type { LoanListItem } from "@/lib/api/loan/types";
import { LOAN_TYPE_LABEL_KEY } from "@/lib/loans/loan-labels";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** A payment date is a calendar day; read it as one, not as UTC midnight. */
const calendarDay = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

export default function LoansTable({
  loans,
  onRowClick,
}: {
  loans: LoanListItem[];
  onRowClick: (loanKey: number) => void;
  /** Kept for the caller's signature; the list opens a loan to edit it. */
  onEdit?: (loan: LoanListItem) => void;
}) {
  const t = useTranslations("loans");
  const formatPercentage = useFormatPercentage();
  const formatShortDate = useFormatShortDate();
  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("table.loan"),
        cell: ({ row }: { row: { original: LoanListItem } }) => (
          <div className="min-w-40">
            <div className="text-foreground font-medium">
              {row.original.name}
            </div>
            <div className="text-muted-foreground text-sm">
              {[
                t(`types.${LOAN_TYPE_LABEL_KEY[row.original.type] ?? "other"}`),
                row.original.providerName,
              ]
                .filter(Boolean)
                .join(", ")}
            </div>
          </div>
        ),
      },
      {
        id: "progress",
        header: t("table.progress"),
        cell: ({ row }: { row: { original: LoanListItem } }) =>
          typeof row.original.progressPercentage === "number" ? (
            <LoanProgressIndicator
              className="min-w-40"
              value={row.original.progressPercentage}
              label={t("summary.progressLabel", {
                value: Math.round(
                  Math.max(0, Math.min(100, row.original.progressPercentage)),
                ),
              })}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "nextPayment",
        header: () => (
          <div className="text-right">{t("table.nextPayment")}</div>
        ),
        cell: ({ row }: { row: { original: LoanListItem } }) => (
          <div className="text-right whitespace-nowrap">
            <Amount
              value={row.original.regularPaymentAmount}
              currency={row.original.currency.code}
              className="font-mono"
            />
            <div className="text-muted-foreground text-xs">
              {row.original.nextPaymentDate
                ? formatShortDate(calendarDay(row.original.nextPaymentDate))
                : "—"}
            </div>
          </div>
        ),
      },
      {
        id: "rate",
        header: () => <div className="text-right">{t("table.rate")}</div>,
        cell: ({ row }: { row: { original: LoanListItem } }) => (
          <div className="text-right font-mono">
            {typeof row.original.annualInterestRateBps === "number"
              ? formatPercentage(row.original.annualInterestRateBps / 10000, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "—"}
          </div>
        ),
      },
      {
        accessorKey: "outstandingPrincipal",
        // A figure column's head sits over its figures, on the right.
        header: () => (
          <div className="text-right">{t("table.outstanding")}</div>
        ),
        cell: ({ row }: { row: { original: LoanListItem } }) => (
          <div className="text-right">
            <Amount
              value={row.original.outstandingPrincipal}
              currency={row.original.currency.code}
              className="font-mono"
            />
          </div>
        ),
      },
    ],
    [t, formatPercentage, formatShortDate],
  );
  return (
    <Table
      columns={columns as any}
      data={loans}
      variant="ledger"
      withScrollAffordance
      onRowClick={(row) => onRowClick(row.original.loanKey)}
    />
  );
}
