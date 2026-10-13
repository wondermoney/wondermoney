"use client";

import { type ColumnDef, createColumnHelper, Row } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Amount } from "@/components/ui/Amount";
import CategoryIcon from "@/components/ui/CategoryIcon";
import { Table } from "@/components/ui/Table";
import TableCellEditable from "@/components/ui/Table/Cell/TableCellEditable";
import { Text } from "@/components/ui/Typography";
import { Budget } from "@/lib/api/budget/useBudgets";
import useEditBudgetCategory from "@/lib/api/budget/useEditBudgetCategory";
import useRemoveCategoryFromBudget from "@/lib/api/budget/useRemoveCategoryFromBudget";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { cn } from "@/lib/utils";
import {
  calculateParentBudgetedFromSubRows,
  getBudgetRowMonthlyBudgetedTotal,
} from "@/lib/utils/budget";
import { getThresholdClassName } from "@/lib/utils/formatCurrency";
import { parseLocaleNumber } from "@/lib/utils/number";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";
import { useBreakpoint } from "@/lib/utils/useTailwindBreakpoints";

import { getCategoryTranslationKey } from "../../lib/utils/categories";
import {
  getCurrencySymbol,
  SupportedCurrencyCodes,
} from "../../lib/utils/currencySymbol";
import { Button } from "../ui/button";
import CellNumeric from "../ui/Table/Cell/CellNumeric";

export type BudgetSubRow = {
  key: number;
  name: string;
  budgeted: number;
  icon: string;
  textColor: string;
  bgColor: string;
  isSystemCategory: boolean;
  recurrency?: number;
};
export type BudgetRow = BudgetSubRow & { subRows: BudgetSubRow[] };

function MobileBudgetEditorList({
  data,
  monthlyIncome,
  currency,
  onRemoveCategory,
  updateData,
  loadingSet,
  loadingDeleteSet,
}: {
  monthlyIncome: BudgetTableProps["monthlyIncome"];
  currency: BudgetTableProps["currency"];
  data: BudgetRow[];
  onRemoveCategory: (row: Row<BudgetRow>) => void;
  updateData: (
    row: Row<BudgetRow>,
    columnId: string,
    value: string,
  ) => boolean | void;
  loadingSet: Set<string>;
  loadingDeleteSet: Set<string>;
}) {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();

  return (
    <div className="space-y-3 md:hidden">
      {data.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border px-4 py-6 text-sm">
          {t("table-empty-state")}
        </div>
      ) : null}
      {data.map((parentRow, parentIndex) => {
        const parentLoadingKey = `${parentIndex}`;

        return (
          <div
            key={parentRow.key}
            className="border-border bg-card rounded-lg border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: parentRow.bgColor }}
                  >
                    <CategoryIcon icon={parentRow.icon} />
                  </div>
                  <Text className="min-w-0 truncate font-medium">
                    {parentRow.isSystemCategory
                      ? t(getCategoryTranslationKey(parentRow.name))
                      : parentRow.name}
                  </Text>
                </div>
              </div>

              <Button
                variant="ghost"
                title={t("delete")}
                aria-label={t("delete")}
                loading={loadingDeleteSet.has(parentLoadingKey)}
                className="text-muted-foreground hover:text-destructive-text h-10 w-10 shrink-0"
                onClick={() =>
                  onRemoveCategory({
                    id: parentLoadingKey,
                    original: parentRow,
                    depth: 0,
                  } as Row<BudgetRow>)
                }
              >
                {!loadingDeleteSet.has(parentLoadingKey) && (
                  <Trash className="size-4" />
                )}
              </Button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <Text variant="smallText" className="text-muted-foreground">
                  {t("monthly")}
                </Text>
                <Text className="font-mono text-sm whitespace-nowrap">
                  <Amount value={parentRow.budgeted} currency={currency} />
                </Text>
              </div>
              <div>
                <Text variant="smallText" className="text-muted-foreground">
                  {t("monthly-percentage")}
                </Text>
                <Text className="font-mono text-sm whitespace-nowrap">
                  {formatPercentage(parentRow.budgeted / monthlyIncome, {
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </div>
              <div>
                <Text variant="smallText" className="text-muted-foreground">
                  {t("annually")}
                </Text>
                <Text className="font-mono text-sm whitespace-nowrap">
                  <Amount value={parentRow.budgeted * 12} currency={currency} />
                </Text>
              </div>
            </div>

            {parentRow.subRows.length > 0 ? (
              <div className="border-border/70 mt-4 space-y-3 border-l pl-3">
                {parentRow.subRows.map((row, childIndex) => {
                  const loadingKey = `${parentIndex}.${childIndex}`;

                  return (
                    <div key={row.key} className="bg-muted/30 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex size-9 shrink-0 items-center justify-center rounded-md"
                              style={{ backgroundColor: row.bgColor }}
                            >
                              <CategoryIcon icon={row.icon} />
                            </div>
                            <Text className="min-w-0 truncate font-medium">
                              {row.isSystemCategory
                                ? t(getCategoryTranslationKey(row.name))
                                : row.name}
                            </Text>
                          </div>
                          <div className="text-muted-foreground mt-3 space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">{t("monthly")}</span>
                              <TableCellEditable
                                className="min-w-[140px]"
                                row={
                                  {
                                    id: loadingKey,
                                    original: row,
                                    depth: 1,
                                  } as Row<BudgetRow>
                                }
                                value={Number(row.budgeted).toFixed(2)}
                                column={{ id: "budgeted" }}
                                updateData={updateData}
                                inputPrefix={getCurrencySymbol(currency)}
                                isLoading={loadingSet.has(
                                  `${loadingKey}-budgeted`,
                                )}
                                min={1}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">
                                {t("monthly-percentage")}
                              </span>
                              <span className="text-foreground font-mono">
                                {formatPercentage(
                                  row.budgeted / monthlyIncome,
                                  {
                                    maximumFractionDigits: 2,
                                  },
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">{t("annually")}</span>
                              <span className="text-foreground font-mono">
                                <Amount value={row.budgeted * 12} currency={currency} />
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate">
                                {t("recurrence")}
                              </span>
                              <span className="text-foreground font-mono">
                                {row.recurrency ?? 12}x
                              </span>
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          title={t("delete")}
                          aria-label={t("delete")}
                          loading={loadingDeleteSet.has(loadingKey)}
                          className="text-muted-foreground hover:text-destructive-text h-10 w-10 shrink-0"
                          onClick={() =>
                            onRemoveCategory({
                              id: loadingKey,
                              original: row,
                              depth: 1,
                            } as Row<BudgetRow>)
                          }
                        >
                          {!loadingDeleteSet.has(loadingKey) && (
                            <Trash className="size-4" />
                          )}
                        </Button>
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
  monthlyIncome: number;
  currency: SupportedCurrencyCodes;
  onBudgetChange?: (rows: BudgetRow[]) => void;
}

const BudgetTable: React.FC<BudgetTableProps> = ({
  budget,
  budgetKey,
  year,
  month,
  monthlyIncome,
  currency,
  onBudgetChange,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();
  const notifyIfRateLimited = useRateLimitToast();
  const isDesktop = useBreakpoint("md");
  const [data, setData] = useState(budget);
  const dataRef = useRef(budget);
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());
  const [loadingDeleteSet, setLoadingDeleteSet] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    dataRef.current = budget;
    setData(budget);
  }, [budget]);

  const {
    totalMonthly,
    totalPercentage,
    totalAnual,
    savingsMonthly,
    savingsClassName,
    savingsPercentage,
    savingsAnual,
  } = useMemo(() => {
    const totalMonthly = getBudgetRowMonthlyBudgetedTotal(data);

    const totalMonthlySavings = monthlyIncome - totalMonthly;

    return {
      totalMonthly: formatCurrency(totalMonthly, currency, {
        notation: "standard",
        maximumFractionDigits: 2,
      }),
      totalPercentage: (totalMonthly / monthlyIncome) * 100,
      totalAnual: formatCurrency(totalMonthly * 12, currency, {
        notation: "standard",
        maximumFractionDigits: 2,
      }),
      savingsMonthly: formatCurrency(totalMonthlySavings, currency, {
        notation: "standard",
        maximumFractionDigits: 2,
      }),
      savingsClassName: getThresholdClassName(totalMonthlySavings),
      savingsPercentage: (totalMonthlySavings / monthlyIncome) * 100,
      savingsAnual: formatCurrency(totalMonthlySavings * 12, currency, {
        notation: "standard",
        maximumFractionDigits: 2,
      }),
    };
  }, [data, formatCurrency, monthlyIncome, currency]);

  const editBudgetCategoryMutation = useEditBudgetCategory();
  const removeCategoryFromBudgetMutation = useRemoveCategoryFromBudget();

  // When our cell renderer calls updateMyData, we'll use the rowIndex, columnId and new value to
  // update the original data
  const updateData = useCallback(
    (row: Row<BudgetRow>, columnId: string, value: string) => {
      const categoryKey = row.original.key;
      const newBudgetedValue = parseLocaleNumber(value);

      if (!Number.isFinite(newBudgetedValue) || newBudgetedValue <= 0) {
        toast.error(t("budget-amount-positive"));
        return false;
      }

      const previousBudgetedValue = dataRef.current
        .flatMap((row) => row.subRows)
        .find((subRow) => subRow.key === categoryKey)?.budgeted;

      const updateCategoryBudgetedValue = (
        rows: BudgetRow[],
        nextBudgetedValue: number,
        expectedCurrentValue?: number,
      ) =>
        rows.map((row) => {
          const hasTargetCategory = row.subRows.some(
            (subRow) => subRow.key === categoryKey,
          );

          if (hasTargetCategory) {
            const updatedSubRows = row.subRows.map((subRow) => {
              if (subRow.key !== categoryKey) {
                return subRow;
              }

              if (
                expectedCurrentValue !== undefined &&
                !Object.is(subRow.budgeted, expectedCurrentValue)
              ) {
                return subRow;
              }

              return { ...subRow, budgeted: nextBudgetedValue };
            });

            return {
              ...row,
              budgeted: calculateParentBudgetedFromSubRows(updatedSubRows),
              subRows: updatedSubRows,
            };
          }
          return row;
        });

      const updated = updateCategoryBudgetedValue(
        dataRef.current,
        newBudgetedValue,
      );

      dataRef.current = updated;
      setData(updated);
      onBudgetChange?.(updated);

      const loadingKey = `${row.id}-${columnId}`;
      setLoadingSet((prev) => new Set(prev).add(loadingKey));

      editBudgetCategoryMutation.mutate(
        { categoryKey, amount: newBudgetedValue, budgetKey, year, month },
        {
          onSettled: () => {
            setLoadingSet((prev) => {
              const newSet = new Set(prev);
              newSet.delete(loadingKey);
              return newSet;
            });
          },
          onError: (error) => {
            if (notifyIfRateLimited(error)) return;
            if (previousBudgetedValue !== undefined) {
              const rolledBack = updateCategoryBudgetedValue(
                dataRef.current,
                previousBudgetedValue,
                newBudgetedValue,
              );

              dataRef.current = rolledBack;
              setData(rolledBack);
              onBudgetChange?.(rolledBack);
            }

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

      return true;
    },
    [
      editBudgetCategoryMutation,
      budgetKey,
      year,
      month,
      notifyIfRateLimited,
      onBudgetChange,
      t,
    ],
  );

  const onRemoveCategory = useCallback(
    (row: Row<BudgetRow>) => {
      const isChildRow = row.depth > 0;
      const categoryKey = row.original.key;
      const loadingKey = row.id;

      setLoadingDeleteSet((prev) => new Set(prev).add(loadingKey));

      removeCategoryFromBudgetMutation.mutate(
        { categoryKey, budgetKey },
        {
          onSuccess: () => {
            let updated: BudgetRow[];
            if (isChildRow) {
              // For child rows, remove from parent's subRows
              updated = dataRef.current.map((parentRow) => {
                const hasTargetCategory = parentRow.subRows.some(
                  (subRow) => subRow.key === categoryKey,
                );

                if (hasTargetCategory) {
                  const updatedSubRows = parentRow.subRows.filter(
                    (subRow) => subRow.key !== categoryKey,
                  );

                  return {
                    ...parentRow,
                    budgeted:
                      calculateParentBudgetedFromSubRows(updatedSubRows),
                    subRows: updatedSubRows,
                  };
                }
                return parentRow;
              });
            } else {
              // For parent rows, remove entire category
              updated = dataRef.current.filter(
                (parentRow) => parentRow.key !== categoryKey,
              );
            }
            dataRef.current = updated;
            setData(updated);
            onBudgetChange?.(updated);
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
      removeCategoryFromBudgetMutation,
      budgetKey,
      notifyIfRateLimited,
      onBudgetChange,
      t,
    ],
  );

  const columnHelper = createColumnHelper<BudgetRow>();
  // https://github.com/TanStack/table/issues/4382#issuecomment-1801830220
  const columns: ColumnDef<BudgetRow, any>[] = useMemo(
    () => [
      columnHelper.display({
        id: "expander", // Make sure it has an ID
        size: 50,
        header: ({ table }) => (
          <Button
            variant="ghost"
            onClick={table.getToggleAllRowsExpandedHandler()}
            size={isDesktop ? "default" : "xs"}
          >
            {table.getIsAllRowsExpanded() ? (
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
          <div className="flex flex-col">
            <div className="flex h-16 items-center">
              <Text className={"whitespace-nowrap"}>{t("total")}</Text>
            </div>
            <div className="flex h-16 items-center">
              <Text className={"whitespace-nowrap"}>{t("savings")}</Text>
            </div>
          </div>
        ),
        cell: ({ row, getValue }) => {
          return (
            <div className="flex items-center gap-2">
              <div
                className="flex size-10 items-center justify-center rounded-md"
                style={{
                  backgroundColor: row.original.bgColor,
                }}
              >
                <CategoryIcon icon={row.original.icon} />
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
      columnHelper.accessor("recurrency", {
        header: undefined,
        size: 90,
        cell: ({ row, getValue }) =>
          row.depth > 0 && (
            <Button variant="ghost" aria-readonly disabled>
              {getValue() ?? 12}x
            </Button>
          ),
      }),
      columnHelper.accessor("budgeted", {
        header: () => <div className="text-right">{t("monthly")}</div>,
        size: 220,
        footer: () => (
          <div className="flex flex-col">
            <div className="flex h-16 items-center justify-end">
              <CellNumeric>{totalMonthly}</CellNumeric>
            </div>
            <div className="flex h-16 items-center justify-end">
              <CellNumeric className={savingsClassName}>
                {savingsMonthly}
              </CellNumeric>
            </div>
          </div>
        ),
        cell: ({ row, getValue, column }) => {
          return row.depth === 0 ? (
            <CellNumeric className="pr-2">
              <Amount value={getValue()} currency={currency} />
            </CellNumeric>
          ) : (
            <TableCellEditable
              className="ml-auto min-w-[120px]"
              row={row}
              value={Number(getValue()).toFixed(2)}
              column={column}
              updateData={updateData}
              inputPrefix={getCurrencySymbol(currency)}
              isLoading={loadingSet.has(`${row.id}-${column.id}`)}
              min={1}
            />
          );
        },
      }),
      columnHelper.display({
        id: "budgetedMonthlyPercentage",
        size: 140,
        header: () => (
          <div className="text-right whitespace-nowrap">
            {t("monthly-percentage")}
          </div>
        ),
        footer: () => (
          <div className="flex flex-col">
            <div className="flex h-16 items-center justify-end">
              <CellNumeric>{totalPercentage.toFixed(2)}%</CellNumeric>
            </div>
            <div className="flex h-16 items-center justify-end">
              <CellNumeric className={savingsClassName}>
                {savingsPercentage.toFixed(2)}%
              </CellNumeric>
            </div>
          </div>
        ),
        cell: ({ row }) => {
          return (
            <CellNumeric>
              <Text
                className={cn(
                  "whitespace-nowrap",
                  row.depth === 0 ? "font-semibold" : "font-normal",
                )}
              >
                {formatPercentage(row.original.budgeted / monthlyIncome, {
                  maximumFractionDigits: 2,
                })}
              </Text>
            </CellNumeric>
          );
        },
      }),
      columnHelper.display({
        id: "budgetedAnually",
        size: 140,
        header: () => <div className="text-right">{t("annually")}</div>,
        footer: () => (
          <div className="flex flex-col">
            <div className="flex h-16 items-center justify-end">
              <CellNumeric>{totalAnual}</CellNumeric>
            </div>
            <div className="flex h-16 items-center justify-end">
              <CellNumeric className={savingsClassName}>
                {savingsAnual}
              </CellNumeric>
            </div>
          </div>
        ),
        cell: ({ row }) => {
          return (
            <CellNumeric>
              <Text
                className={cn(
                  "whitespace-nowrap",
                  row.depth === 0 ? "font-semibold" : "font-normal",
                )}
              >
                <Amount value={row.original.budgeted * 12} currency={currency} />
              </Text>
            </CellNumeric>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        enableHiding: false,
        size: 65,
        cell: ({ row }) => {
          return (
            <Button
              variant="ghost"
              title={t("delete")}
              aria-label={t("delete")}
              loading={loadingDeleteSet.has(row.id)}
              className="text-muted-foreground hover:text-destructive-text"
              onClick={() => onRemoveCategory(row)}
            >
              {!loadingDeleteSet.has(row.id) && <Trash className="size-4" />}
            </Button>
          );
        },
      }),
    ],
    [
      formatPercentage,
      columnHelper,
      isDesktop,
      t,
      onRemoveCategory,
      loadingDeleteSet,
      updateData,
      loadingSet,
      currency,
      monthlyIncome,
      totalMonthly,
      totalPercentage,
      totalAnual,
      savingsMonthly,
      savingsClassName,
      savingsPercentage,
      savingsAnual,
    ],
  );

  return (
    <>
      <div className="hidden md:block">
        <Table
          columns={columns}
          data={data}
          meta={{
            updateData,
            getRowStyles: (): CSSProperties => ({
              borderColor: "transparent",
              height: 64,
            }),
            // Was `backgroundColor: row.depth % 2 ? "white" : "#f8fafc"`, a
            // literal white and a literal slate-50 that ignored the theme
            // entirely: on the dark canvas every row painted white while the
            // text stayed near-white, so the whole category table measured
            // 1.00:1 and was invisible. A neutral tint pulled from the
            // foreground reads as a darkening in light and a lightening in
            // dark, so the group/child banding survives both halves.
            getRowClasses: (row: Row<BudgetRow>) => ({
              "bg-foreground/[0.04]": row.depth === 0,
            }),
          }}
          withScrollAffordance
          withExpandableRows
          defaultExpanded
        />
      </div>
      <MobileBudgetEditorList
        data={data}
        monthlyIncome={monthlyIncome}
        currency={currency}
        onRemoveCategory={onRemoveCategory}
        updateData={updateData}
        loadingSet={loadingSet}
        loadingDeleteSet={loadingDeleteSet}
      />
    </>
  );
};

export default BudgetTable;
