"use client";

import { MoreHorizontal, Pencil, Trash } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { memo, useCallback, useMemo, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Progress } from "@/components/ui/progress";
import { Table } from "@/components/ui/Table";
import CellNumeric from "@/components/ui/Table/Cell/CellNumeric";
import {
  type ColumnDef,
  createColumnHelper,
  type Row,
} from "@/components/ui/Table/features";
import { Text } from "@/components/ui/Typography";
import { useRouter } from "@/i18n/navigation";
import type { BudgetFull } from "@/lib/api/budget/useBudgetsFull";
import { cn } from "@/lib/utils";
import {
  calculatePlannedAndSpentValue,
  convertBudgetTemplatesIntoRows,
} from "@/lib/utils/budget";
import { formatCurrencyForLocale } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";
import { useBreakpoint } from "@/lib/utils/useTailwindBreakpoints";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import BudgetDeleteModal from "./BudgetDeleteModal";
import BudgetEditModal from "./BudgetEditModal";

interface BudgetsTableProps {
  budgets: BudgetFull[];
}

/**
 * How many budgeted lines a budget actually carries: a leaf category where a
 * parent has children, the parent itself where it has none. `categories`
 * arrives as the union of parent aggregates and their children, so counting
 * the raw array would double-count every parent.
 */
const countBudgetedCategories = (budget: BudgetFull) =>
  convertBudgetTemplatesIntoRows(budget.categories).reduce(
    (total, row) => total + (row.subRows.length > 0 ? row.subRows.length : 1),
    0,
  );

/** Stored income amounts are already the monthly-equivalent value the wizard
 *  submitted (see `lib/budget/wizard/income.ts`), so recurrency must not be
 *  applied again here. */
const monthlyIncomeOf = (budget: BudgetFull) =>
  budget.incomes.reduce((total, income) => total + income.amount, 0);

const BudgetsTable: React.FC<BudgetsTableProps> = memo(({ budgets }) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();
  const locale = useLocale();
  const router = useRouter();
  const posthog = usePostHog();
  const isDesktop = useBreakpoint("md");

  const [budgetData, setBudgetData] = useState<{
    name: BudgetFull["name"] | null;
    key: BudgetFull["budgetKey"] | null;
  }>({ name: null, key: null });

  const [editBudgetModalIsOpen, setEditBudgetModalIsOpen] = useState(false);
  const editBudgetCloseModal = () => {
    setEditBudgetModalIsOpen(false);
    setBudgetData({ name: null, key: null });
    posthog.capture("edit_budget_modal", { action: "closed" });
  };
  const editBudgetOpenModal = useCallback(
    (rowIndex: number) => {
      const { name, budgetKey } = budgets[rowIndex];
      setBudgetData({ name, key: budgetKey });
      setEditBudgetModalIsOpen(true);
      posthog.capture("edit_budget_modal", { action: "opened" });
    },
    [budgets, posthog],
  );

  const [deleteBudgetModalIsOpen, setDeleteBudgetModalIsOpen] = useState(false);
  const deleteBudgetCloseModal = () => {
    setDeleteBudgetModalIsOpen(false);
    setBudgetData({ name: null, key: null });
    posthog.capture("delete_budget_modal", { action: "closed" });
  };
  const deleteBudgetOpenModal = useCallback(
    (rowIndex: number) => {
      const { name, budgetKey } = budgets[rowIndex];
      setBudgetData({ name, key: budgetKey });
      setDeleteBudgetModalIsOpen(true);
      posthog.capture("delete_budget_modal", { action: "opened" });
    },
    [budgets, posthog],
  );

  const columnHelper = useMemo(() => createColumnHelper<BudgetFull>(), []);

  // Memoize budget stats calculations to prevent recalculation on every render
  // This was causing N budgets × 2 columns = 2N expensive calculations per render
  const budgetStats = useMemo(
    () =>
      budgets.map((budget) => {
        const rows = convertBudgetTemplatesIntoRows(budget.categories);
        const { totalPlanned, totalSpent } =
          calculatePlannedAndSpentValue(rows);
        const progress =
          totalPlanned > 0 ? (totalSpent / totalPlanned) * 100 : 0;

        return {
          totalSpent,
          totalBudgeted: totalPlanned,
          progress,
        };
      }),
    [budgets],
  );

  // The wizard never asks for a name, so every budget it creates is called the
  // same thing. Two of them side by side were two identical rows and clicking
  // one was a coin flip. This is the secondary line that tells them apart: the
  // income streams the household typed in (the only free text the flow
  // collects), the money those add up to per month, how many category lines
  // the budget carries, and the accounts it watches. `month`/`year` are
  // deliberately absent — the API only ever returns budgets that have a
  // template for the *current* month, so the period is identical on every row
  // and would be noise, not a distinction.
  const rowMetadata = useMemo(() => {
    const parts = budgets.map((budget) => {
      const facts: string[] = [];

      if (budget.incomes.length > 0) {
        facts.push(
          t("budget-row-income-summary", {
            amount: formatCurrencyForLocale(
              monthlyIncomeOf(budget),
              budget.currencyCode,
              locale,
            ),
            sources: budget.incomes.map((income) => income.name).join(", "),
          }),
        );
      }

      facts.push(
        t("budget-row-category-count", {
          count: countBudgetedCategories(budget),
        }),
      );

      if (budget.accounts.length === 1) {
        facts.push(budget.accounts[0].accountName);
      } else if (budget.accounts.length > 1) {
        facts.push(
          t("budget-row-account-count", { count: budget.accounts.length }),
        );
      }

      return facts;
    });

    // Answer the wizard identically twice and the two budgets really are the
    // same object twice over — no amount of derived metadata separates them.
    // Only then is the budget's own identifier worth the space: it is already
    // what the row navigates to, and an honest identifier beats two rows the
    // user cannot choose between.
    const signatures = budgets.map((budget, index) =>
      JSON.stringify([budget.name, ...parts[index]]),
    );
    const occurrences = signatures.reduce(
      (counts, signature) =>
        counts.set(signature, (counts.get(signature) ?? 0) + 1),
      new Map<string, number>(),
    );

    return budgets.map((budget, index) =>
      (occurrences.get(signatures[index]) ?? 0) > 1
        ? [
            ...parts[index],
            t("budget-row-identifier", { id: String(budget.budgetKey) }),
          ]
        : parts[index],
    );
  }, [budgets, locale, t]);

  // Memoize columns to prevent unnecessary table re-renders
  // https://github.com/TanStack/table/issues/4382#issuecomment-1801830220
  const desktopColumns: ColumnDef<BudgetFull, any>[] = useMemo(
    () => [
      columnHelper.display({
        header: () => (
          <div className="text-right">{t("spent-vs-budgeted")}</div>
        ),
        id: "spent-vs-budgeted",
        cell: ({ row }) => {
          const { totalSpent, totalBudgeted } = budgetStats[row.index];
          return (
            <CellNumeric className="text-right whitespace-nowrap">
              <Amount value={totalSpent} currency={row.original.currencyCode} />{" "}
              /{" "}
              <Amount
                value={totalBudgeted}
                currency={row.original.currencyCode}
              />
            </CellNumeric>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        enableHiding: false,
        cell: ({ cell }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="ml-auto flex size-8 p-0">
                <span className="sr-only">{t("open-menu")}</span>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  editBudgetOpenModal(cell.row.index);
                }}
              >
                <Pencil className="text-foreground size-4" /> {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive-text flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBudgetOpenModal(cell.row.index);
                }}
              >
                <Trash className="size-4" /> {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      }),
    ],
    [columnHelper, t, budgetStats, editBudgetOpenModal, deleteBudgetOpenModal],
  );

  const columns: ColumnDef<BudgetFull, any>[] = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: t("name"),
        cell: ({ row }) => (
          <div className="flex max-w-40 min-w-0 flex-col gap-1 sm:max-w-xs">
            <Text
              variant="smallText"
              className="text-foreground block truncate font-medium"
            >
              {row.original.name}
            </Text>
            <Text
              variant="smallText"
              className="text-muted-foreground block truncate text-xs"
              title={rowMetadata[row.index].join("\n")}
            >
              {/* Facts set apart by space, not joined with middle dots
                  ("A · B · C" is template punctuation); the tooltip lists
                  them one per line. */}
              {rowMetadata[row.index].map((fact, index) => (
                <span key={index} className={index > 0 ? "ml-3" : undefined}>
                  {fact}
                </span>
              ))}
            </Text>
          </div>
        ),
      }),
      columnHelper.display({
        header: t("progress"),
        id: "progress",
        cell: ({ row }) => {
          const { progress, totalSpent, totalBudgeted } =
            budgetStats[row.index];

          // At 0% this was an empty grey track with `0%` floated off to its
          // right — a full-width hairline sitting between the name and the
          // figures, which is the shape this system uses for a divider. It
          // measured nothing, so it now says what it knows in words instead.
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
              {/* The bar restates the percentage beside it, so it is hidden
                  from the accessibility tree rather than announced twice as an
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
      ...(isDesktop ? desktopColumns : []),
    ],
    [
      formatPercentage,
      columnHelper,
      t,
      budgetStats,
      rowMetadata,
      isDesktop,
      desktopColumns,
    ],
  );

  const onRowClick = (row: Row<BudgetFull>) => {
    posthog.capture("budgets_table_row_clicked");
    const now = new Date();
    router.push(
      `/budgets/${row.original.budgetKey}/${now.getFullYear()}/${
        now.getMonth() + 1
      }`,
    );
  };

  return (
    <>
      <Table columns={columns} data={budgets} onRowClick={onRowClick} />
      {budgetData.key && budgetData.name && (
        <>
          <BudgetEditModal
            isOpen={editBudgetModalIsOpen}
            onOpenChange={setEditBudgetModalIsOpen}
            budgetName={budgetData.name}
            budgetKey={budgetData.key}
          />
          <BudgetDeleteModal
            isOpen={deleteBudgetModalIsOpen}
            closeModal={deleteBudgetCloseModal}
            budgetName={budgetData.name}
            budgetKey={budgetData.key}
          />
        </>
      )}
    </>
  );
});

BudgetsTable.displayName = "BudgetsTable";

export default BudgetsTable;
