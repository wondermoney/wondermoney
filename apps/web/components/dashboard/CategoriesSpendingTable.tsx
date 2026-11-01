"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import CategoryIcon, {
  categoryIconStyle,
} from "@/components/ui/CategoryIcon";
import { Table } from "@/components/ui/Table";
import { type ColumnDef, createColumnHelper } from "@/components/ui/Table/features";
import { Text } from "@/components/ui/Typography";
import type { CategoriesSpending } from "@/lib/api/account/useTransactionsCategorySpending";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

import { getCategoryTranslationKey } from "../../lib/utils/categories";
import { Progress } from "../ui/progress";
import CellNumeric from "../ui/Table/Cell/CellNumeric";
import TableCellDefault from "../ui/Table/Cell/TableCellDefault";

interface CategoriesSpendingTableProps {
  categoriesSpending: CategoriesSpending[];
}

interface MobileCategoriesSpendingListProps {
  categoriesSpending: CategoriesSpending[];
  totalAmount: number;
}

function MobileCategoriesSpendingList({
  categoriesSpending,
  totalAmount,
}: MobileCategoriesSpendingListProps) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();

  return (
    // Shell-less on purpose: the border, background and radius belong to the
    // card the caller wraps this in, so the two "last week" panels on the
    // dashboard cannot drift apart.
    <div className="divide-border divide-y md:hidden">
      {categoriesSpending.map((category) => {
        const progress = totalAmount > 0 ? category.amount / totalAmount : 0;

        return (
          <div key={category.categoryKey} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <CategoryIcon
                  icon={category.icon}
                  category={!category.icon ? category.name : undefined}
                  style={categoryIconStyle(category.bgColor)}
                />
                <Text
                  variant="smallText"
                  className="text-foreground truncate font-medium"
                >
                  {category.isSystemCategory
                    ? t(getCategoryTranslationKey(category.name))
                    : category.name}
                </Text>
              </div>
              <CellNumeric className="shrink-0 text-right font-mono whitespace-nowrap">
                <Amount value={category.amount} currency={category.currency!} />
              </CellNumeric>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">
                  {t("num-transactions")}
                </p>
                <CellNumeric className="mt-1 justify-start">
                  {category.numTransactions}
                </CellNumeric>
              </div>

              <div>
                <p className="text-muted-foreground text-xs">
                  {t("distribution")}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Progress
                    value={progress * 100}
                    className="h-2 flex-1 rounded"
                  />
                  <CellNumeric className="w-12 text-right whitespace-nowrap">
                    {formatPercentage(progress)}
                  </CellNumeric>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const CategoriesSpendingTable: React.FC<CategoriesSpendingTableProps> = ({
  categoriesSpending,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();

  const totalAmount = useMemo(
    () => categoriesSpending.reduce((acc, curr) => acc + curr.amount, 0),
    [categoriesSpending],
  );

  const columnHelper = createColumnHelper<CategoriesSpending>();
  // https://github.com/TanStack/table/issues/4382#issuecomment-1801830220
  const columns: ColumnDef<CategoriesSpending, any>[] = [
    columnHelper.accessor("name", {
      header: t("name"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <CategoryIcon
            icon={row.original.icon}
            category={!row.original.icon ? row.original.name : undefined}
            style={categoryIconStyle(row.original.bgColor)}
          />
          <TableCellDefault
            value={
              row.original.isSystemCategory
                ? t(getCategoryTranslationKey(row.original.name))
                : row.original.name
            }
          />
        </div>
      ),
    }),
    columnHelper.accessor("numTransactions", {
      header: () => (
        <div className="text-right whitespace-nowrap">
          {t("num-transactions")}
        </div>
      ),
      cell: (info) => (
        <CellNumeric className="justify-start">{info.getValue()}</CellNumeric>
      ),
    }),
    columnHelper.display({
      header: t("distribution"),
      id: "distribution",
      cell: ({ row }) => {
        const progress = row.original.amount / totalAmount;
        return (
          <div className="flex items-center gap-2">
            <Progress value={progress * 100} className="h-2 flex-1 rounded" />
            <CellNumeric className="w-6 text-right whitespace-nowrap sm:w-12">
              {formatPercentage(progress)}
            </CellNumeric>
          </div>
        );
      },
    }),
    columnHelper.accessor("amount", {
      header: () => <div className="text-right">{t("amount")}</div>,
      cell: (info) => (
        <CellNumeric className="text-right">
          <Amount value={info.getValue()} currency={info.row.original.currency!} />
        </CellNumeric>
      ),
    }),
  ];

  return (
    <>
      <MobileCategoriesSpendingList
        categoriesSpending={categoriesSpending}
        totalAmount={totalAmount}
      />
      <div className="hidden md:block">
        <Table columns={columns} data={categoriesSpending} />
      </div>
    </>
  );
};

export default CategoriesSpendingTable;
