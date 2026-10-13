"use client";

import { type ColumnDef, createColumnHelper, Row } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { CSSProperties } from "react";

import { Amount } from "@/components/ui/Amount";
import { Table } from "@/components/ui/Table";
import { Text } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";

import { SupportedCurrencyCodes } from "../../lib/utils/currencySymbol";
import CellNumeric from "../ui/Table/Cell/CellNumeric";

export type OverviewRow = {
  name: string;
  spent: number;
  budgeted: number;
  remaining: number;
  remainingPercentage: number;
};

interface BudgetOverviewTableProps {
  data: OverviewRow[];
  currency: SupportedCurrencyCodes;
}

const BudgetOverviewTable: React.FC<BudgetOverviewTableProps> = ({
  data,
  currency,
}) => {
  const t = useTranslations();

  const columnHelper = createColumnHelper<OverviewRow>();
  // https://github.com/TanStack/table/issues/4382#issuecomment-1801830220
  const columns: ColumnDef<OverviewRow, any>[] = [
    columnHelper.accessor("name", {
      header: t("overview"),
      size: 500,
      cell: ({ row, getValue }) => {
        return (
          <div className="flex items-center gap-2">
            <Text
              className={cn(
                "whitespace-nowrap",
                row.depth === 0 ? "font-semibold" : "font-normal",
              )}
            >
              {getValue()}
            </Text>
          </div>
        );
      },
    }),
    columnHelper.accessor("spent", {
      header: () => (
        <div className="text-right whitespace-nowrap">
          {t("spent")} - {t("total")} ({t("in-percentage")})
        </div>
      ),
      cell: ({ getValue }) => (
        <CellNumeric>
          <Amount value={getValue()} currency={currency} />
        </CellNumeric>
      ),
    }),
    columnHelper.accessor("budgeted", {
      header: () => (
        <div className="text-right whitespace-nowrap">
          {t("budgeted")} - {t("total")} ({t("in-percentage")})
        </div>
      ),
      cell: ({ getValue }) => (
        <CellNumeric>
          <Amount value={getValue()} currency={currency} />
        </CellNumeric>
      ),
    }),
    columnHelper.accessor("remaining", {
      header: () => (
        <div className="text-right whitespace-nowrap">
          {t("remaining")} - {t("total")} ({t("in-percentage")})
        </div>
      ),
      cell: ({ row, getValue }) => (
        <CellNumeric>
          <Amount value={getValue()} currency={currency} />{" "}
          ({(row.original.remainingPercentage * 100).toFixed(0)}%)
        </CellNumeric>
      ),
    }),
  ];

  return (
    <Table
      columns={columns}
      data={data}
      meta={{ getRowStyles: (): CSSProperties => ({ height: 64 }) }}
    />
  );
};

export default BudgetOverviewTable;
