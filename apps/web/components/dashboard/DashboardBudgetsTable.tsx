"use client";

import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Table } from "@/components/ui/Table";
import { Text } from "@/components/ui/Typography";
import type { BudgetFull } from "@/lib/api/budget/useBudgetsFull";
import { cn } from "@/lib/utils";
import {
  calculatePlannedAndSpentValue,
  convertBudgetTemplatesIntoRows,
} from "@/lib/utils/budget";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

import { Progress } from "../ui/progress";
import CellNumeric from "../ui/Table/Cell/CellNumeric";

interface DashboardBudgetsTableProps {
  budgets: BudgetFull[];
}

interface BudgetRow {
  name: string;
  totalSpent: number;
  totalBudgeted: number;
  progress: number;
  currency: string;
}

interface MobileBudgetListProps {
  budgets: BudgetRow[];
}

function MobileBudgetList({ budgets }: MobileBudgetListProps) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();

  return (
    <div className="divide-border divide-y md:hidden">
      {budgets.map((budget) => {
        const progress = Math.min(budget.progress, 100);
        const isOverBudget = budget.progress > 100;
        const measurable =
          budget.totalBudgeted > 0 ? budget.totalSpent !== 0 : false;

        return (
          <div key={budget.name} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <Text
                variant="smallText"
                className="text-foreground min-w-0 flex-1 truncate font-medium"
              >
                {budget.name}
              </Text>
              {measurable ? (
                <CellNumeric
                  className={cn(
                    "shrink-0 text-right whitespace-nowrap",
                    isOverBudget ? "text-destructive-text" : undefined,
                  )}
                >
                  {formatPercentage(budget.progress / 100)}
                  {isOverBudget ? (
                    <span className="sr-only">{t("over-budget")}</span>
                  ) : null}
                </CellNumeric>
              ) : null}
            </div>

            {measurable ? (
              <div className="mt-3 flex items-center gap-2">
                <Progress
                  aria-hidden="true"
                  value={progress}
                  className="h-2 flex-1 rounded"
                  indicatorClassName={
                    isOverBudget ? "bg-destructive" : undefined
                  }
                />
              </div>
            ) : (
              <Text
                variant="smallText"
                className="text-muted-foreground mt-3 block whitespace-nowrap"
              >
                {budget.totalBudgeted <= 0
                  ? t("budget-row-nothing-budgeted")
                  : t("budget-row-nothing-spent")}
              </Text>
            )}

            <div className="mt-3 space-y-1">
              <Text variant="smallText" className="text-muted-foreground">
                {t("spent-vs-budgeted")}
              </Text>
              <div className="space-y-1 leading-tight">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                  <Text variant="smallText" className="text-muted-foreground">
                    {t("spent")}
                  </Text>
                  <Text
                    variant="smallText"
                    className="text-foreground min-w-0 text-right font-mono break-all"
                  >
                    <Amount value={budget.totalSpent} currency={budget.currency} />
                  </Text>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                  <Text variant="smallText" className="text-muted-foreground">
                    {t("budgeted")}
                  </Text>
                  <Text
                    variant="smallText"
                    className="text-foreground min-w-0 text-right font-mono break-all"
                  >
                    <Amount value={budget.totalBudgeted} currency={budget.currency} />
                  </Text>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const DashboardBudgetsTable: React.FC<DashboardBudgetsTableProps> = ({
  budgets,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();

  const budgetRows = useMemo<BudgetRow[]>(() => {
    return budgets.map((budget) => {
      const rows = convertBudgetTemplatesIntoRows(budget.categories);
      const { totalPlanned, totalSpent } = calculatePlannedAndSpentValue(rows);

      const progress = totalPlanned > 0 ? (totalSpent / totalPlanned) * 100 : 0;

      return {
        name: budget.name,
        totalSpent,
        totalBudgeted: totalPlanned,
        progress,
        currency: budget.currencyCode,
      };
    });
  }, [budgets]);

  const columnHelper = createColumnHelper<BudgetRow>();
  const columns: ColumnDef<BudgetRow, any>[] = [
    columnHelper.accessor("name", {
      header: t("name"),
      cell: ({ row }) => (
        <Text variant="smallText" className="whitespace-nowrap">
          {row.original.name}
        </Text>
      ),
    }),
    columnHelper.display({
      header: t("progress"),
      id: "progress",
      cell: ({ row }) => {
        const { progress, totalBudgeted, totalSpent } = row.original;

        // RAD-551, ported by RAD-569. At 0% this was an empty grey track with
        // `0%` floated off to its right — a full-width hairline sitting between
        // the name and the figures, which is the shape this system uses for a
        // divider. It measured nothing, so it says what it knows in words.
        if (totalBudgeted <= 0) {
          return (
            <Text
              variant="smallText"
              className="text-muted-foreground block whitespace-nowrap"
            >
              {t("budget-row-nothing-budgeted")}
            </Text>
          );
        }

        if (totalSpent === 0) {
          return (
            <Text
              variant="smallText"
              className="text-muted-foreground block whitespace-nowrap"
            >
              {t("budget-row-nothing-spent")}
            </Text>
          );
        }

        const progressCapped = Math.min(progress, 100);
        const isOverBudget = progress > 100;
        return (
          <div className="flex items-center gap-2">
            {/* The bar restates the percentage beside it, so it is hidden from
                the accessibility tree rather than announced twice as an
                unnamed progressbar. */}
            <Progress
              aria-hidden="true"
              value={progressCapped}
              className="h-2 flex-1 rounded"
              indicatorClassName={isOverBudget ? "bg-destructive" : undefined}
            />
            <CellNumeric
              className={cn(
                "w-12 text-right whitespace-nowrap",
                isOverBudget && "text-destructive-text",
              )}
            >
              {formatPercentage(progress / 100)}
              {/* Over budget was carried by the red fill alone. The figure
                  passing 100% is the visible non-colour cue; this is the
                  audible one. */}
              {isOverBudget ? (
                <span className="sr-only">{t("over-budget")}</span>
              ) : null}
            </CellNumeric>
          </div>
        );
      },
    }),
    columnHelper.display({
      header: () => <div className="text-right">{t("spent-vs-budgeted")}</div>,
      id: "spent-vs-budgeted",
      cell: ({ row }) => (
        <CellNumeric className="text-right whitespace-nowrap">
          <Amount value={row.original.totalSpent} currency={row.original.currency} /> /{" "}
          <Amount value={row.original.totalBudgeted} currency={row.original.currency} />
        </CellNumeric>
      ),
    }),
  ];

  return (
    <>
      <MobileBudgetList budgets={budgetRows} />
      <div className="hidden md:block">
        <Table columns={columns} data={budgetRows} />
      </div>
    </>
  );
};

export default DashboardBudgetsTable;
