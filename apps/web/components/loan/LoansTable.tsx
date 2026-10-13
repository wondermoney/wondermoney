"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Table } from "@/components/ui/Table";
import type { LoanListItem } from "@/lib/api/loan/types";
import { LOAN_TYPE_LABEL_KEY } from "@/lib/loans/loan-labels";
export default function LoansTable({
  loans,
  onRowClick,
  onEdit,
}: {
  loans: LoanListItem[];
  onRowClick: (loanKey: number) => void;
  onEdit: (loan: LoanListItem) => void;
}) {
  const t = useTranslations("loans");
  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: t("table.loan"),
        cell: ({ row }: { row: { original: LoanListItem } }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-muted-foreground text-sm">
              {t(`types.${LOAN_TYPE_LABEL_KEY[row.original.type] ?? "other"}`)}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "outstandingPrincipal",
        header: t("table.outstanding"),
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
    [t],
  );
  return (
    // § 9 observation 4: a table sits on the canvas, separated by hairline
    // rules — the card is reserved for things that are genuinely a unit.
    <div className="border-border border-y">
      <Table
        columns={columns as any}
        data={loans}
        onRowClick={(row) => onRowClick(row.original.loanKey)}
      />
    </div>
  );
}
