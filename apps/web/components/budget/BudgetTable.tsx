"use client";

import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { CSSProperties, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Amount } from "@/components/ui/Amount";
import CategoryIcon from "@/components/ui/CategoryIcon";
import { Measure } from "@/components/ui/Measure";
import { Table } from "@/components/ui/Table";
import {
  type ColumnDef,
  createColumnHelper,
  Row,
} from "@/components/ui/Table/features";
import { Text } from "@/components/ui/Typography";
import { Budget } from "@/lib/api/budget/useBudgets";
import useDeleteBudgetCategory from "@/lib/api/budget/useDeleteBudgetCategory";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import type { BudgetRow } from "@/lib/budget/rows";
import { cn } from "@/lib/utils";
import {
  getBudgetRowProgress,
  getBudgetRowRemaining,
  getMonthlyAvailableValue,
} from "@/lib/utils/budget";
import { getThresholdClassName } from "@/lib/utils/formatCurrency";
import { convertMonthlyAmountToAnuallizedMonthlyAmount } from "@/lib/utils/recurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";
import { useBreakpoint } from "@/lib/utils/useTailwindBreakpoints";

import { getCategoryTranslationKey } from "../../lib/utils/categories";
import { SupportedCurrencyCodes } from "../../lib/utils/currencySymbol";
import { Button } from "../ui/button";
import CellNumeric from "../ui/Table/Cell/CellNumeric";
import TableCellDefault from "../ui/Table/Cell/TableCellDefault";
import { BudgetCategoryActionsMenu } from "./BudgetCategoryActionsMenu";
import { RolloverCarryLine } from "./RolloverCarryLine";

export type { BudgetRow } from "@/lib/budget/rows";

/**
 * The measure's shared scale: the largest plan or spend among the categories
 * and their subcategories, each planned figure taken as the Planned column
 * shows it plus what rollover carried in (the amount the bar measures
 * against), so a €58 plan and a €548 plan read at their true sizes.
 */
function measureScale(rows: BudgetRow[]): number {
  const planned = getMonthlyAvailableValue;
  return Math.max(
    0,
    ...rows.flatMap((row) => [
      planned(row),
      row.spent,
      ...row.subRows.flatMap((child) => [planned(child), child.spent]),
    ]),
  );
}

function MobileBudgetCategoriesList({
  data,
  budgetKey,
  year,
  month,
  currency,
  view,
  noActions,
  onDeleteRow,
}: {
  budgetKey: BudgetTableProps["budgetKey"];
  year: BudgetTableProps["year"];
  month: BudgetTableProps["month"];
  currency: BudgetTableProps["currency"];
  view: BudgetTableProps["view"];
  noActions?: BudgetTableProps["noActions"];
  data: BudgetRow[];
  onDeleteRow: (row: Row<BudgetRow>) => void;
}) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();
  const scaleMax = measureScale(data);

  return (
    <div className="space-y-3 md:hidden">
      {data.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border px-4 py-6 text-sm">
          {t("table-empty-state")}
        </div>
      ) : null}
      {data.map((parentRow, parentIndex) => {
        const normalizedParentBudgetedValue =
          convertMonthlyAmountToAnuallizedMonthlyAmount(
            parentRow.budgeted,
            parentRow.recurrency,
          );
        // Measured against what the month may spend: the plan plus what
        // rollover carried in.
        const parentAvailable = getMonthlyAvailableValue(parentRow);
        const parentRemaining = getBudgetRowRemaining(parentRow);
        const parentProgress = getBudgetRowProgress(parentRow);
        const parentName = parentRow.isSystemCategory
          ? t(getCategoryTranslationKey(parentRow.name))
          : parentRow.name;

        return (
          <div
            key={parentRow.key}
            className="border-border bg-card rounded-lg border p-3 sm:p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: parentRow.bgColor,
                      color: parentRow.textColor,
                    }}
                  >
                    <CategoryIcon
                      icon={parentRow.icon}
                      className="text-current"
                    />
                  </div>
                  <Text className="min-w-0 truncate font-medium">
                    {parentRow.isSystemCategory
                      ? t(getCategoryTranslationKey(parentRow.name))
                      : parentRow.name}
                  </Text>
                </div>
              </div>
              {/* `Text` renders inline elements (`<span>`, `<small>`), so a
                  label stacked over a value only stacks if the container makes
                  it — without this the row reads "€0.00Monthly remaining". */}
              <div className="flex shrink-0 flex-col items-end text-right">
                <Text className="font-mono text-sm font-semibold whitespace-nowrap">
                  <Amount value={parentRemaining} currency={currency} />
                </Text>
                <Text variant="smallText" className="text-muted-foreground">
                  {view === "month"
                    ? t("monthly-remaining")
                    : t("annual-remaining")}
                </Text>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <Text variant="smallText" className="text-muted-foreground">
                  {view === "month" ? t("monthly-spent") : t("annual-spent")}
                </Text>
                <Text className="font-mono text-sm whitespace-nowrap">
                  <Amount value={parentRow.spent} currency={currency} />
                </Text>
              </div>
              <div className="flex flex-col gap-0.5">
                <Text variant="smallText" className="text-muted-foreground">
                  {view === "month"
                    ? t("monthly-planned")
                    : t("annual-planned")}
                </Text>
                <Text className="font-mono text-sm whitespace-nowrap">
                  <Amount
                    value={normalizedParentBudgetedValue}
                    currency={currency}
                  />
                </Text>
                <RolloverCarryLine row={parentRow} currency={currency} />
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <Text variant="smallText" className="text-muted-foreground">
                  {t("progress")}
                </Text>
                <Text className="font-mono text-sm whitespace-nowrap">
                  {formatPercentage(parentProgress)}
                </Text>
              </div>
              <Measure
                spent={parentRow.spent}
                planned={parentAvailable}
                scaleMax={scaleMax}
                label={t("budgetPage.measure-label", {
                  name: parentName,
                  spent: formatCurrency(parentRow.spent, currency),
                  planned: formatCurrency(parentAvailable, currency),
                })}
              />
            </div>

            {parentRow.subRows.length > 0 ? (
              <div className="border-border/70 mt-4 space-y-3 border-l pl-3">
                {parentRow.subRows.map((row, childIndex) => {
                  const normalizedBudgetedValue =
                    convertMonthlyAmountToAnuallizedMonthlyAmount(
                      row.budgeted,
                      row.recurrency,
                    );
                  const available = getMonthlyAvailableValue(row);
                  const remaining = getBudgetRowRemaining(row);
                  const progress = getBudgetRowProgress(row);

                  return (
                    <div key={row.key} className="bg-muted/30 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex size-9 shrink-0 items-center justify-center rounded-md"
                              style={{
                                backgroundColor: row.bgColor,
                                color: row.textColor,
                              }}
                            >
                              <CategoryIcon
                                icon={row.icon}
                                className="text-current"
                              />
                            </div>
                            <Text className="min-w-0 truncate font-medium">
                              {row.isSystemCategory
                                ? t(getCategoryTranslationKey(row.name))
                                : row.name}
                            </Text>
                          </div>
                          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                            <span className="truncate">
                              {view === "month"
                                ? t("monthly-planned")
                                : t("annual-planned")}
                              :{" "}
                              <span className="text-foreground font-mono">
                                <Amount
                                  value={normalizedBudgetedValue}
                                  currency={currency}
                                />
                              </span>
                            </span>
                            <RolloverCarryLine row={row} currency={currency} />
                            <span className="truncate">
                              {view === "month"
                                ? t("monthly-spent")
                                : t("annual-spent")}
                              :{" "}
                              <span className="text-foreground font-mono">
                                <Amount value={row.spent} currency={currency} />
                              </span>
                            </span>
                            <span className="truncate">
                              {view === "month"
                                ? t("monthly-remaining")
                                : t("annual-remaining")}
                              :{" "}
                              <span className="text-foreground font-mono">
                                <Amount value={remaining} currency={currency} />
                              </span>
                            </span>
                            <span className="truncate">
                              {t("recurrence")}:{" "}
                              <span className="text-foreground font-mono">
                                {t("times-per-year", {
                                  count: row.recurrency ?? 12,
                                })}
                              </span>
                            </span>
                          </div>
                        </div>

                        {!noActions && (
                          <BudgetCategoryActionsMenu
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-10 w-10 shrink-0"
                                aria-label={t("actions")}
                              >
                                <Ellipsis className="size-4" />
                              </Button>
                            }
                            align="end"
                            category={row as any}
                            budgetKey={budgetKey}
                            year={year}
                            month={month}
                            currency={currency}
                            onDelete={() =>
                              onDeleteRow({
                                id: `${parentIndex}.${childIndex}`,
                                original: row,
                              } as Row<BudgetRow>)
                            }
                          />
                        )}
                      </div>

                      <div className="mt-3">
                        <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
                          <span className="truncate">{t("progress")}</span>
                          <span className="text-foreground font-mono">
                            {formatPercentage(progress)}
                          </span>
                        </div>
                        <Measure
                          spent={row.spent}
                          planned={available}
                          scaleMax={scaleMax}
                          label={t("budgetPage.measure-label", {
                            name: row.isSystemCategory
                              ? t(getCategoryTranslationKey(row.name))
                              : row.name,
                            spent: formatCurrency(row.spent, currency),
                            planned: formatCurrency(available, currency),
                          })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface BudgetTableProps {
  budgetKey: Budget["budgetKey"];
  budget: BudgetRow[];
  year: number;
  month: number;
  currency: SupportedCurrencyCodes;
  view: "year" | "month";
  footerData?: {
    totalPlanned: string;
    totalSpent: string;
    totalPercentage: number;
  };
  noActions?: boolean;
}

const BudgetTable: React.FC<BudgetTableProps> = React.memo(
  ({
    budget,
    budgetKey,
    year,
    month,
    view,
    currency,
    footerData,
    noActions = false,
  }) => {
    const t = useTranslations();
    const formatPercentage = useFormatPercentage();
    const formatCurrency = useFormatCurrency();
    const notifyIfRateLimited = useRateLimitToast();
    const [data, setData] = useState(budget);
    const isDesktop = useBreakpoint("md");
    const [loadingDeleteSet, setLoadingDeleteSet] = useState<Set<string>>(
      new Set(),
    );
    // Take the new budget when the prop changes (adjusted during render).
    const [prevBudget, setPrevBudget] = useState(budget);
    if (budget !== prevBudget) {
      setPrevBudget(budget);
      setData(budget);
    }

    const deleteBudgetCategoryMutation = useDeleteBudgetCategory();

    const onDeleteRow = useCallback(
      (row: Row<BudgetRow>) => {
        const [categoryIndex, subCategoryIndex] = row.id.split(".").map(Number);
        const categoryKey = row.original.key;

        const loadingKey = row.id;
        setLoadingDeleteSet((prev) => new Set(prev).add(loadingKey));

        deleteBudgetCategoryMutation.mutate(
          { categoryKey, budgetKey, year, month },
          {
            onSuccess: () => {
              setData((old) =>
                old.map((row, index) => {
                  if (index === categoryIndex) {
                    return {
                      ...row,
                      subRows: [
                        ...row.subRows.slice(0, subCategoryIndex),
                        ...row.subRows.slice(subCategoryIndex + 1),
                      ],
                    };
                  }
                  return row;
                }),
              );
            },
            onSettled: () => {
              setLoadingDeleteSet((prev) => {
                const newSet = new Set(prev);
                newSet.delete(loadingKey);
                return newSet;
              });
            },
            onError: (error) => {
              if (notifyIfRateLimited(error)) return;
              if (isDemoReadOnlyError(error)) {
                toast.error(t("demo-read-only-title"), {
                  description: t("demo-read-only-description"),
                  duration: 9000,
                });
                return;
              }

              toast.error(t("server-error"));
            },
          },
        );
      },
      [
        budgetKey,
        year,
        month,
        deleteBudgetCategoryMutation,
        notifyIfRateLimited,
        t,
      ],
    );

    const scaleMax = useMemo(() => measureScale(data), [data]);
    const columnHelper = useMemo(() => createColumnHelper<BudgetRow>(), []);

    // Memoize columns to prevent unnecessary table re-renders
    // https://github.com/TanStack/table/issues/4382#issuecomment-1801830220
    const columns: ColumnDef<BudgetRow, any>[] = useMemo(
      () => [
        columnHelper.display({
          id: "expander", // Make sure it has an ID
          size: 50,
          header: (info) => (
            <Button
              variant="ghost"
              onClick={info.table.getToggleAllRowsExpandedHandler()}
              size={isDesktop ? "default" : "xs"}
            >
              {info.table.getIsAllRowsExpanded() ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          ),
          cell: (info) => {
            return (
              <div className={info.row.depth === 1 ? "pl-2" : ""}>
                {info.row.getCanExpand() ? (
                  <Button
                    variant="ghost"
                    onClick={info.row.getToggleExpandedHandler()}
                    size={isDesktop ? "default" : "xs"}
                  >
                    {info.row.getIsExpanded() ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </Button>
                ) : null}
              </div>
            );
          },
          maxSize: isDesktop ? 60 : 48,
        }),
        columnHelper.accessor("name", {
          header: t("category"),
          footer: () => (
            <div className="flex h-14 items-center">
              <Text className={"whitespace-nowrap"}>{t("total")}</Text>
            </div>
          ),
          cell: ({ row, getValue }) => {
            return (
              <div className="flex items-center gap-2">
                <div
                  className="flex size-10 items-center justify-center rounded-md"
                  style={{
                    backgroundColor: row.original.bgColor,
                    color: row.original.textColor,
                  }}
                >
                  <CategoryIcon
                    icon={row.original.icon}
                    className="text-current"
                  />
                </div>
                <Text
                  className={cn(
                    "whitespace-nowrap",
                    row.depth === 0 ? "font-semibold" : "font-normal",
                  )}
                >
                  {row.original.isSystemCategory
                    ? t(getCategoryTranslationKey(getValue()))
                    : getValue()}
                </Text>
              </div>
            );
          },
        }),
        columnHelper.display({
          id: "measure",
          header: () => (
            <div className="whitespace-nowrap">
              {t("budgetPage.measure-header")}
            </div>
          ),
          size: 260,
          cell: ({ row }) => {
            // The plan plus what rollover carried in.
            const planned = getMonthlyAvailableValue(row.original);
            const name = row.original.isSystemCategory
              ? t(getCategoryTranslationKey(row.original.name))
              : row.original.name;
            return (
              <Measure
                className="w-full min-w-40"
                spent={row.original.spent}
                planned={planned}
                scaleMax={scaleMax}
                label={t("budgetPage.measure-label", {
                  name,
                  spent: formatCurrency(row.original.spent, currency),
                  planned: formatCurrency(planned, currency),
                })}
              />
            );
          },
        }),
        columnHelper.accessor("recurrency", {
          header: "",
          size: 120,
          cell: ({ row, getValue }) =>
            row.depth > 0 && (
              <Button variant="ghost" aria-readonly disabled>
                {t("times-per-year", { count: getValue() ?? 12 })}
              </Button>
            ),
        }),
        columnHelper.accessor("spent", {
          header: () => (
            <div className="text-right">
              {view === "month" ? t("monthly-spent") : t("annual-spent")}
            </div>
          ),
          size: 220,
          footer: () =>
            footerData && (
              <div className="flex h-14 items-center justify-end">
                <CellNumeric>{footerData.totalSpent}</CellNumeric>
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
            <div className="text-right">
              {view === "month" ? t("monthly-planned") : t("annual-planned")}
            </div>
          ),
          size: 220,
          footer: () =>
            footerData && (
              <div className="flex h-14 items-center justify-end">
                <CellNumeric>{footerData.totalPlanned}</CellNumeric>
              </div>
            ),
          cell: ({ row, getValue }) => (
            <CellNumeric className="flex-col items-end gap-0.5">
              <Amount
                value={convertMonthlyAmountToAnuallizedMonthlyAmount(
                  getValue(),
                  row.original.recurrency,
                )}
                currency={currency}
              />
              <RolloverCarryLine row={row.original} currency={currency} />
            </CellNumeric>
          ),
        }),
        columnHelper.display({
          id: "remaining",
          size: 150,
          header: () => (
            <div className="flex flex-col items-end">
              <div className="whitespace-nowrap">
                {view === "month"
                  ? t("monthly-remaining")
                  : t("annual-remaining")}
              </div>
              <div className="text-xs">({t("in-percentage")})</div>
            </div>
          ),
          footer: () =>
            footerData && (
              <div className="flex h-14 items-center justify-end">
                <CellNumeric>
                  {/* Locale-aware, like every other percentage in the
                      table: `toFixed` printed `53.17%` to pt and es too. */}
                  {formatPercentage(footerData.totalPercentage / 100, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </CellNumeric>
              </div>
            ),
          cell: ({ row }) => {
            // Against what the month may spend: the plan plus what
            // rollover carried in.
            const available = getMonthlyAvailableValue(row.original);
            const remaining = getBudgetRowRemaining(row.original);
            const remainingPercentage =
              available === 0 ? 0 : remaining / available;

            return (
              <CellNumeric className="flex-col items-end">
                <Text
                  className={cn(
                    "whitespace-nowrap",
                    row.depth === 0 ? "font-semibold" : "font-normal",
                  )}
                >
                  {/* `tone="threshold"` rather than a class on the wrapper:
                      <Amount> sets its own text colour, so an outer
                      getThresholdClassName would be overridden and overspend
                      would silently render as ordinary foreground ink. */}
                  {/* Overspend was red ink and a sign alone. The warning
                      glyph is the visible non-colour cue, the sr-only word
                      the audible one (DESIGN.md: colour never carries
                      meaning by itself). */}
                  {remaining < 0 ? (
                    <>
                      <TriangleAlert
                        className="text-destructive-text mr-1 inline size-3.5 align-[-0.125em]"
                        aria-hidden="true"
                      />
                      <span className="sr-only">{t("over-budget")}</span>
                    </>
                  ) : null}
                  <Amount
                    value={remaining}
                    currency={currency}
                    tone="threshold"
                  />
                </Text>
                <Text
                  variant="smallText"
                  className={getThresholdClassName(remaining)}
                >
                  {formatPercentage(remainingPercentage)}
                </Text>
              </CellNumeric>
            );
          },
        }),
        // Conditionally include actions column
        ...(!noActions
          ? [
              columnHelper.display({
                id: "actions",
                enableHiding: false,
                size: 65,
                cell: ({ row }) =>
                  row.depth > 0 && (
                    <BudgetCategoryActionsMenu
                      trigger={
                        <button
                          type="button"
                          aria-label={t("actions")}
                          className="hover:bg-muted focus-visible:ring-ring -m-2 inline-flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <Ellipsis className="text-foreground size-4" />
                        </button>
                      }
                      category={row.original}
                      budgetKey={budgetKey}
                      year={year}
                      month={month}
                      currency={currency}
                      onDelete={() => onDeleteRow(row)}
                    />
                  ),
              }),
            ]
          : []),
      ],
      [
        formatPercentage,
        columnHelper,
        t,
        isDesktop,
        onDeleteRow,
        noActions,
        budgetKey,
        year,
        month,
        currency,
        view,
        footerData,
        scaleMax,
        formatCurrency,
      ],
    );

    return (
      <>
        <div className="hidden md:block">
          <Table
            columns={columns}
            data={data}
            meta={{
              getRowStyles: (_row: Row<BudgetRow>): CSSProperties => ({
                height: 64,
              }),
            }}
            withScrollAffordance
            withExpandableRows
            defaultExpanded={false}
            variant="ledger"
          />
        </div>
        <MobileBudgetCategoriesList
          data={data}
          budgetKey={budgetKey}
          year={year}
          month={month}
          currency={currency}
          view={view}
          noActions={noActions}
          onDeleteRow={onDeleteRow}
        />
      </>
    );
  },
);

BudgetTable.displayName = "BudgetTable";

export default BudgetTable;
