"use client";

import { useTranslations } from "next-intl";
import { CSSProperties } from "react";

import { Amount } from "@/components/ui/Amount";
import { Table } from "@/components/ui/Table";
import {
  type ColumnDef,
  createColumnHelper,
  Row,
} from "@/components/ui/Table/features";
import { Text } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

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
  const formatPercentage = useFormatPercentage();

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
        <div className="text-right whitespace-nowrap">{t("spent")}</div>
      ),
      cell: ({ getValue }) => (
        <CellNumeric>
          <Amount value={getValue()} currency={currency} />
        </CellNumeric>
      ),
    }),
    columnHelper.accessor("budgeted", {
      header: () => (
        <div className="text-right whitespace-nowrap">{t("budgeted")}</div>
      ),
      cell: ({ getValue }) => (
        <CellNumeric>
          <Amount value={getValue()} currency={currency} />
        </CellNumeric>
      ),
    }),
    columnHelper.accessor("remaining", {
      header: () => (
        // Was "Spent - Total (in %)" on all three columns: a hyphen-joined
        // label fragment, and only this column carries a percentage. The
        // rows are already totals (Month, Year), so "Total" said nothing.
        // Same two-line head as the category table's remaining column.
        <div className="flex flex-col items-end">
          <div className="whitespace-nowrap">{t("remaining")}</div>
          <div className="text-xs">({t("in-percentage")})</div>
        </div>
      ),
      cell: ({ row, getValue }) => (
        <CellNumeric>
          <Amount value={getValue()} currency={currency} /> (
          {formatPercentage(row.original.remainingPercentage)})
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
