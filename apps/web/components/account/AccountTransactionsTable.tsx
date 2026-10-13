"use client";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ColumnDef,
  createColumnHelper,
  type Row,
  type Table as TableType,
} from "@tanstack/react-table";
import { Filter, Info, MoreHorizontal, Pencil, X } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import DatePickerRange from "@/components/ui/DatePickerRange";
import { Table } from "@/components/ui/Table";
import { useRouter } from "@/i18n/navigation";
import useEditTransaction from "@/lib/api/account/useEditTransaction";
import type { Transaction } from "@/lib/api/account/useTransactions";
import type { Category } from "@/lib/api/category/useCategories";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";
import { useBreakpoint } from "@/lib/utils/useTailwindBreakpoints";

import {
  getAllCategories,
  getCategoryTranslationKey,
} from "../../lib/utils/categories";
import CategorySelect, { CategoryCellContent } from "../CategorySelect";
import FundTransactionFromGoalDialog from "../goals/FundTransactionFromGoalDialog";
import { Amount } from "../ui/Amount";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ComboBoxMulti } from "../ui/combobox-multi";
import { DrawerDialog } from "../ui/dialog-responsive";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { FilterChip, FilterChipBar } from "../ui/FilterChip";
import { InspectorDrawer, PropertyList } from "../ui/InspectorDrawer";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { Switch } from "../ui/switch";
import CellNumeric from "../ui/Table/Cell/CellNumeric";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import AccountTransactionDeleteModal from "./AccountTransactionDeleteModal";
import {
  AccountTransactionEditSheet,
  type FundGoalTransactionRequest,
} from "./AccountTransactionEditSheet";
import TransactionReviewControl from "./TransactionReviewControl";

interface AccountTransactionTableProps {
  transactions: Transaction[];
  categories: Category[];
  showUnreviewedOnly?: boolean;
  showHiddenTransactions?: boolean;
  onShowHiddenTransactionsChange?: (value: boolean) => void;
  transactionDateRange?: DateRange;
  setTransactionDateRange?: (dataRange?: DateRange) => void;
  withAccountFilter?: boolean;
  withFilters?: boolean;
  withPagination?: boolean;
  withSelectRow?: boolean;
  withMultiSelectRow?: boolean;
  withRowActions?: boolean;
  footerActions?: React.ReactNode;
  sticky?: boolean;
  /**
   * RAD-576 — `total` from the transactions endpoint: rows matching the filters
   * the *server* applied, before its `limit`.
   *
   * The footer counted the rows it was holding, so a 500-row page of an 8,623
   * row range said "500 results". Trustworthy only when the server applied every
   * active filter — see `onServerFiltersChange`.
   */
  serverTotal?: number;
  /**
   * RAD-579 — opt into server-side filtering.
   *
   * Account, type, category and needs-review were filtered here, in the browser, over the rows
   * already loaded. Filtering a year by one category filtered whichever page came back — silently,
   * with no way for the user to tell "nothing matched" from "not in this page".
   *
   * Supplying this callback means the parent forwards these to `useTransactions`, so the table
   * stops filtering them locally and lets the refetch do it. Omit it and the table keeps filtering
   * in the browser, which is still correct for a caller whose data source has no such parameters —
   * the per-account page uses `/v1/account/:accountId/transaction`, which does not take them.
   */
  onServerFiltersChange?: (filters: {
    accountKeys: string[];
    categoryKeys: string[];
    needsReview: boolean;
    transactionTypes: string[];
  }) => void;
}

const AccountTransactionsTable: React.FC<AccountTransactionTableProps> =
  React.memo(
    ({
      transactions,
      categories,
      showUnreviewedOnly = false,
      showHiddenTransactions = false,
      onShowHiddenTransactionsChange,
      transactionDateRange,
      setTransactionDateRange,
      withAccountFilter = true,
      withFilters = true,
      withPagination = true,
      withSelectRow = false,
      withMultiSelectRow = false,
      withRowActions = true,
      footerActions,
      sticky = true,
      serverTotal,
      onServerFiltersChange,
    }) => {
      const t = useTranslations();
      const formatCurrency = useFormatCurrency();
      const formatShortDate = useFormatShortDate();
      const notifyIfRateLimited = useRateLimitToast();
      const router = useRouter();
      const posthog = usePostHog();
      const [resetPagination, setResetPagination] = useState(false);
      const isDesktop = useBreakpoint("md");

      // Edit transaction modal
      const [transactionData, setTransactionData] =
        useState<Transaction | null>(null);
      const [editTransactionModalIsOpen, setEditTransactionModalIsOpen] =
        useState(false);
      const [fundGoalTransaction, setFundGoalTransaction] =
        useState<FundGoalTransactionRequest | null>(null);
      const openEditTransactionModal = useCallback(
        (transaction: Transaction) => {
          setTransactionData(transaction);
          setEditTransactionModalIsOpen(true);
        },
        [],
      );
      const closeEditTransactionModal = () => {
        setEditTransactionModalIsOpen(false);
        setTransactionData(null);
      };

      // Delete transaction modal
      const [deleteTransactionModalIsOpen, setDeleteTransactionModalIsOpen] =
        useState(false);
      const openDeleteTransactionModal = useCallback(
        (transaction: Transaction) => {
          setTransactionData(transaction);
          setDeleteTransactionModalIsOpen(true);
        },
        [],
      );
      const closeDeleteTransactionModal = () => {
        setDeleteTransactionModalIsOpen(false);
        setTransactionData(null);
      };

      // Account filter
      const [accountKeysFilter, setAccountKeysFilter] = useState<string[]>([]);

      // Transaction type filter
      const [transactionTypeFilter, setTransactionTypeFilter] = useState<
        string[]
      >([]);

      // Transaction categories filter
      const [transactionCategoryKeysFilter, setTransactionCategoryKeysFilter] =
        useState<string[]>([]);
      const [
        isTransactionCategoryFilterDirty,
        setIsTransactionCategoryFilterDirty,
      ] = useState(false);
      const [needsReviewFilter, setNeedsReviewFilter] = useState(false);

      /*
       * RAD-579 — when the parent forwards filters to the endpoint, the rows arriving here are
       * already filtered across the whole range. Re-applying the same predicates would be
       * harmless but pointless; skipping them is what makes `serverTotal` describe the list.
       */
      const filtersAppliedByServer = onServerFiltersChange !== undefined;

      useEffect(() => {
        onServerFiltersChange?.({
          accountKeys: accountKeysFilter,
          categoryKeys: transactionCategoryKeysFilter,
          needsReview: needsReviewFilter,
          transactionTypes: transactionTypeFilter,
        });
      }, [
        onServerFiltersChange,
        accountKeysFilter,
        transactionCategoryKeysFilter,
        needsReviewFilter,
        transactionTypeFilter,
      ]);

      // Filter transactions data
      const filteredTransactions = useMemo(() => {
        let _filteredTransactions = transactions;
        if (filtersAppliedByServer) return _filteredTransactions;
        // Filter by account
        if (accountKeysFilter.length > 0) {
          _filteredTransactions = _filteredTransactions.filter((transaction) =>
            accountKeysFilter.includes(
              transaction.accountKey.accountKey.toString(),
            ),
          );
        }
        // Filter by transaction type
        if (transactionTypeFilter.length > 0) {
          _filteredTransactions = _filteredTransactions.filter(
            (transaction) =>
              transaction.transactionTypeKey &&
              transactionTypeFilter.includes(
                transaction.transactionTypeKey.name,
              ),
          );
        }
        // Filter by transaction categories
        if (showUnreviewedOnly && !isTransactionCategoryFilterDirty) {
          _filteredTransactions = _filteredTransactions.filter(
            (transaction) => !transaction.reviewed,
          );
        } else if (transactionCategoryKeysFilter.length > 0) {
          _filteredTransactions = _filteredTransactions.filter(
            (transaction) => {
              // Check if "Uncategorized" is selected and transaction has no categories
              const isUncategorizedMatch =
                transactionCategoryKeysFilter.includes("__uncategorized__") &&
                transaction.appuserTransactionCategories.length === 0;

              // Check if transaction matches any of the selected category keys (excluding "Uncategorized")
              const categoryKeysFilter = transactionCategoryKeysFilter.filter(
                (key) => key !== "__uncategorized__",
              );
              const transactionCategoryKeys =
                transaction.appuserTransactionCategories.map((category) =>
                  category.categoryKey.toString(),
                );
              const isCategoryMatch =
                categoryKeysFilter.length > 0 &&
                transactionCategoryKeys.some((categoryKey) =>
                  categoryKeysFilter.includes(categoryKey),
                );

              // Return true if either uncategorized match OR category match
              return isUncategorizedMatch || isCategoryMatch;
            },
          );
        }
        if (needsReviewFilter) {
          _filteredTransactions = _filteredTransactions.filter(
            (transaction) => !transaction.reviewed,
          );
        }
        return _filteredTransactions;
      }, [
        filtersAppliedByServer,
        accountKeysFilter,
        transactionCategoryKeysFilter,
        transactionTypeFilter,
        transactions,
        showUnreviewedOnly,
        isTransactionCategoryFilterDirty,
        needsReviewFilter,
      ]);

      const onTransactionTypeFilterChange = useCallback(
        (transactionTypes: string[]) => {
          posthog.capture("account_transaction_table_filter", {
            filter: "transaction_type",
          });
          setTransactionTypeFilter(transactionTypes);
          setResetPagination(true);
        },
        [posthog],
      );

      const onAccountKeyFilterChange = useCallback(
        (accountKeys: string[]) => {
          posthog.capture("account_transaction_table_filter", {
            filter: "transaction_account",
          });
          setAccountKeysFilter(accountKeys);
          setResetPagination(true);
        },
        [posthog],
      );

      const onCategoryKeyFilterChange = useCallback(
        (categoryKeys: string[]) => {
          posthog.capture("account_transaction_table_filter", {
            filter: "transaction_category",
          });
          setTransactionCategoryKeysFilter(categoryKeys);
          setIsTransactionCategoryFilterDirty(true);
          setResetPagination(true);
        },
        [posthog],
      );

      /*
       * The row being inspected. § 9 InspectorDrawer.
       *
       * Opening a transaction used to mean nothing at all — the row carried a
       * ⋯ menu with a single Edit item, and everything else the row knew
       * (balance after, settlement currency, notes, review state, its audit
       * trail) had nowhere to be shown. The drawer opens over the list, so
       * the table keeps its scroll position, its filters and its page.
       */
      const [inspectedTransaction, setInspectedTransaction] =
        useState<Transaction | null>(null);

      const onDateRangeFilterChange = useCallback(
        (dateRange: DateRange | undefined) => {
          posthog.capture("account_transaction_table_filter", {
            filter: "transaction_date",
          });
          setTransactionDateRange?.(dateRange);
          setResetPagination(true);
        },
        [posthog, setTransactionDateRange],
      );

      const onNeedsReviewFilterChange = useCallback(() => {
        posthog.capture("account_transaction_table_filter", {
          filter: "needs_review",
        });
        setNeedsReviewFilter((value) => !value);
        setResetPagination(true);
      }, [posthog]);

      const queryClient = useQueryClient();
      const {
        mutate: editTransactionMutation,
        isPending: isPendingEditTransaction,
        variables: editTransactionVariables,
      } = useEditTransaction();
      const onChangeCategory = useCallback(
        (transactionKey: number, categoryKey: string) => {
          editTransactionMutation(
            { transactionKey, categoryKey },
            {
              onSuccess: async () => {
                posthog.capture("transaction_categorized", {
                  category_key: categoryKey,
                  source: "table_inline",
                  was_auto_suggested: false,
                });
                // we need this because of the category filter
                await queryClient.invalidateQueries({
                  queryKey: ["accounts-transactions"],
                });
              },
              onError: (error) => {
                if (notifyIfRateLimited(error)) return;
                if (isDemoReadOnlyError(error)) {
                  toast.error(t("demo-read-only-title"), {
                    description: t("demo-read-only-description"),
                  });
                  return;
                }

                toast.error(t("toast-edit-transaction-error"), {
                  duration: 9000,
                });
              },
            },
          );
        },
        [editTransactionMutation, notifyIfRateLimited, posthog, queryClient, t],
      );

      const TransactionActionsMenu = useCallback(
        ({
          transaction,
          triggerClassName = "ml-auto flex size-8 p-0",
        }: {
          transaction: Transaction;
          triggerClassName?: string;
        }) => (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={triggerClassName}>
                <span className="sr-only">{t("open-menu")}</span>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditTransactionModal(transaction);
                }}
              >
                <Pencil className="text-muted-foreground size-4" /> {t("edit")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        [t, openEditTransactionModal],
      );

      const MobileTransactionsList = () => (
        <div className="md:hidden">
          <div className="divide-border border-border bg-card divide-y rounded-md">
            {mobileTransactions.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center p-4">
                <p className="text-muted-foreground text-sm">
                  {t("table-empty-state")}
                </p>
              </div>
            ) : null}
            {mobileTransactions.map((transaction) => {
              const amount =
                transaction.editedSettlementAmount ??
                transaction.appuserSettlementAmount;
              const firstCategory = transaction.appuserTransactionCategories[0];
              const categoryLabel = firstCategory
                ? firstCategory.isSystemCategory
                  ? t(getCategoryTranslationKey(firstCategory.name))
                  : firstCategory.name
                : null;

              return (
                <div
                  key={transaction.transactionKey}
                  className={cn("p-4", { "opacity-50": transaction.hidden })}
                >
                  {/* § 9 rules 10 and 11: the row stacks several facts with
                      the figure on the primary line, rather than pushing the
                      most important fact to a third line of its own. The
                      amount was also `break-all` — which splits -€33.85 mid
                      number, the exact opposite of the never-wrap rule — and
                      hand-rolled its own sign colouring, which a transaction
                      amount does not get: it is a level, not a delta. */}
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {transaction.transactionMerchantKey?.name ??
                            transaction.description ??
                            "—"}
                        </p>
                      </div>
                      <Amount
                        value={amount}
                        currency={transaction.appuserCurrencyKey.code}
                        className="shrink-0 font-mono text-sm leading-tight font-semibold"
                      />
                      {withRowActions && (
                        <TransactionActionsMenu
                          transaction={transaction}
                          triggerClassName="-mt-1 flex size-8 shrink-0 p-0"
                        />
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-muted-foreground truncate text-xs">
                        {transaction.accountKey.accountName} ·{" "}
                        {formatShortDate(transaction.transactionDate)}
                      </p>
                      {categoryLabel ? (
                        <p className="text-muted-foreground truncate text-xs">
                          {categoryLabel}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {withPagination && mobilePageCount > 1 ? (
              <div className="bg-muted/50 flex items-center justify-between gap-3 p-2">
                <span className="text-muted-foreground px-2 text-sm">
                  {t("page")} {safeMobilePageIndex + 1} {t("of")}{" "}
                  {mobilePageCount}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("go-to-previous-page")}
                    disabled={safeMobilePageIndex === 0}
                    onClick={() =>
                      setMobilePageIndex((pageIndex) =>
                        Math.max(0, pageIndex - 1),
                      )
                    }
                  >
                    {t("previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("go-to-next-page")}
                    disabled={safeMobilePageIndex >= mobilePageCount - 1}
                    onClick={() =>
                      setMobilePageIndex((pageIndex) =>
                        Math.min(mobilePageCount - 1, pageIndex + 1),
                      )
                    }
                  >
                    {t("next")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      );

      const columnHelper = useMemo(() => createColumnHelper<Transaction>(), []);
      // Memoize columns to prevent unnecessary table re-renders
      // https://github.com/TanStack/table/issues/4382#issuecomment-1801830220
      const desktopColumns: ColumnDef<Transaction, any>[] = useMemo(
        () => [
          ...(withRowActions
            ? [
                columnHelper.display({
                  id: "actions",
                  enableHiding: false,
                  size: 48,
                  cell: ({ row }) => {
                    return (
                      <TransactionActionsMenu transaction={row.original} />
                    );
                  },
                }),
              ]
            : []),
        ],
        [withRowActions, columnHelper, TransactionActionsMenu],
      );
      const columns: ColumnDef<Transaction, any>[] = useMemo(
        () => [
          columnHelper.accessor("description", {
            header: t("description"),
            cell: (info) => {
              const description = info.getValue();
              const recurringSeries = info.row.original.recurringSeries;
              const recurringLabel =
                recurringSeries?.type === "subscription"
                  ? t("recurring.subscription")
                  : recurringSeries?.type === "bill"
                    ? t("recurring.bill")
                    : null;
              const recurringStatusLabel = recurringSeries
                ? recurringSeries.status === "confirmed"
                  ? t("recurring.confirmed")
                  : recurringSeries.status === "candidate"
                    ? t("recurring.detected")
                    : recurringSeries.status === "paused"
                      ? t("recurring.paused")
                      : recurringSeries.status === "dismissed"
                        ? t("recurring.dismissed")
                        : recurringSeries.status === "ended"
                          ? t("recurring.ended")
                          : null
                : null;
              const account = info.row.original.accountKey;
              const logoUrl =
                account.accountFinancialInstitutionKey?.logoUrl ?? null;

              /*
               * § 9 rule 10 — one row, several facts, no wrapping.
               *
               * Date and account used to be two more equal columns. They are now
               * a muted second line beneath the description: the eye scans a
               * tight primary column and picks up the supporting facts only when
               * it stops. Category and amount stay as their own columns because
               * they carry interactive controls, not just facts.
               */
              return (
                <div className="flex min-w-36 items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      {/* § 9 rule 3: an absent description is an em-dash, not
                          an empty cell. Returning null here used to blank the
                          whole row, taking the account and date with it. */}
                      <span
                        className={cn(
                          "truncate text-sm",
                          description
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {description ||
                          info.row.original.transactionMerchantKey?.name ||
                          "—"}
                      </span>
                      {/* § 9 rule 8: the badge sits inline with the title, not
                          in a trailing column of its own. */}
                      {recurringLabel && recurringStatusLabel ? (
                        <Badge
                          variant="secondary"
                          className="text-muted-foreground h-5 shrink-0 rounded-full px-2 text-[10px] font-medium tracking-wide uppercase"
                        >
                          {recurringLabel} · {recurringStatusLabel}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                      {logoUrl ? (
                        <Image
                          src={logoUrl}
                          height={14}
                          width={14}
                          alt=""
                          className="shrink-0 rounded-[2px]"
                        />
                      ) : null}
                      <span className="truncate">{account.accountName}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">
                        {formatShortDate(info.row.original.transactionDate)}
                      </span>
                    </div>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {info.row.original.descriptionDirty}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              );
            },
          }),
          columnHelper.accessor(
            (row) => row.transactionMerchantKey?.name ?? null,
            {
              id: "transactionMerchant",
              header: t("merchant"),
              cell: (info) => {
                const merchantName = info.getValue();
                /*
                 * § 9 rule 10 — one row, several facts. Not the same fact twice.
                 *
                 * The merchant is often byte-identical to the description
                 * ("Spotify" / "Spotify"), so the column echoed the primary line
                 * and bought nothing on those rows. It now renders only when it
                 * adds something.
                 *
                 * Measured on production, 21,012 transactions: 41.7% of rows
                 * have a merchant that differs from the description and is worth
                 * the column — "Purchase Betano PT Lisboa" → "Betano PT",
                 * "Transfer P2P Coinbase Irel" → "Coinbase". 20% echo it, 15%
                 * have no merchant at all.
                 *
                 * Do not delete this column based on local data: the seeded
                 * dataset is 100% echo, so it renders as a full column of
                 * em-dashes there and looks dead. It is not.
                 *
                 * § 9 rule 3 supplies the rest: an absence — real or redundant —
                 * is an em-dash, not "Not applicable", which was two words of
                 * noise saying no more than the dash does.
                 */
                const description = info.row.original.description?.trim();
                const isEcho =
                  merchantName != null &&
                  description != null &&
                  merchantName.trim().toLowerCase() === description.toLowerCase();
                if (!merchantName || isEcho) {
                  return (
                    <span className="text-muted-foreground text-sm whitespace-nowrap">
                      —
                    </span>
                  );
                }
                return (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-foreground max-w-[12ch] truncate text-sm">
                          {merchantName}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{merchantName}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              },
            },
          ),
          columnHelper.accessor("appuserTransactionCategories", {
            header: t("category"),
            cell: (info) =>
              info.row.original.transactionKey > 0 ? (
                <CategorySelect
                  categories={categories}
                  initialValue={info.getValue().at(0)?.categoryKey?.toString()}
                  onChange={(value) => {
                    onChangeCategory(info.row.original.transactionKey, value);
                  }}
                  loading={
                    isPendingEditTransaction &&
                    editTransactionVariables?.transactionKey ===
                      info.row.original.transactionKey
                  }
                />
              ) : (
                // Same structure as the editable states, so all three of this
                // column's cases share one left edge — the reserved icon slot
                // is what keeps the label in place when there is no icon.
                <div className="flex items-center text-sm">
                  <CategoryCellContent label="—" muted />
                </div>
              ),
          }),
          columnHelper.accessor("appuserSettlementAmount", {
            header: () => <div className="text-right">{t("amount")}</div>,
            cell: (info) => (
              <CellNumeric className="flex flex-col items-end justify-center gap-2">
                <TooltipProvider>
                  <div className="flex items-center gap-2">
                    {info.row.original.editedSettlementAmount && (
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("original-amount")}:{" "}
                          <Amount value={info.getValue()} currency={info.row.original.appuserCurrencyKey.code} />
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <span className="text-foreground font-mono text-sm font-semibold whitespace-nowrap">
                      <Amount value={info.row.original.editedSettlementAmount ?? info.getValue()} currency={info.row.original.appuserCurrencyKey.code} />
                    </span>
                  </div>
                </TooltipProvider>
                {info.row.original.loanRepayment ? (
                  <span className="text-muted-foreground max-w-56 text-right font-mono text-xs">
                    {t("linked-loan-repayment-context", {
                      loanName: info.row.original.loanRepayment.loanName,
                      expense: formatCurrency(
                        info.row.original.loanRepayment.spendingAmount,
                        info.row.original.appuserCurrencyKey.code,
                      ),
                      total: formatCurrency(
                        info.row.original.appuserSettlementAmount,
                        info.row.original.appuserCurrencyKey.code,
                      ),
                    })}
                  </span>
                ) : null}
                {info.row.original.appuserCurrencyKey.code !==
                info.row.original.settlementCurrencyKey.code ? (
                  <span className="text-muted-foreground font-mono text-xs">
                    <Amount value={info.row.original.settlementAmount} currency={info.row.original.settlementCurrencyKey.code} />
                  </span>
                ) : null}
              </CellNumeric>
            ),
          }),
          columnHelper.accessor("appuserCurrencyBalance", {
            header: () => <div className="text-right">{t("balance")}</div>,
            cell: (info) => (
              <CellNumeric className="flex flex-col items-end justify-center gap-2 text-right">
                <span className="text-foreground font-mono text-sm whitespace-nowrap">
                  <Amount value={info.getValue()} currency={info.row.original.appuserCurrencyKey.code} />
                </span>
                {info.row.original.appuserCurrencyKey.code !==
                info.row.original.settlementCurrencyKey.code ? (
                  <span className="text-muted-foreground font-mono text-xs">
                    <Amount value={info.row.original.balance} currency={info.row.original.settlementCurrencyKey.code} />
                  </span>
                ) : null}
              </CellNumeric>
            ),
          }),
          ...(isDesktop ? desktopColumns : []),
        ],
        [
          columnHelper,
          formatCurrency,
          formatShortDate,
          t,
          categories,
          onChangeCategory,
          isPendingEditTransaction,
          editTransactionVariables,
          isDesktop,
          desktopColumns,
        ],
      );

      const columnsWithSelect: ColumnDef<Transaction, any>[] = useMemo(() => {
        if (withSelectRow || withMultiSelectRow) {
          return [
            columnHelper.display({
              id: "select",
              cell: ({ row }) => {
                return (
                  <div className="px-1">
                    <Checkbox
                      checked={row.getIsSelected()}
                      disabled={!row.getCanSelect()}
                      onCheckedChange={row.getToggleSelectedHandler()}
                    />
                  </div>
                );
              },
            }),
            ...columns,
          ];
        }
        return columns;
      }, [columnHelper, withSelectRow, withMultiSelectRow, columns]);

      const transactionsCategories = useMemo(() => {
        // Extract unique category keys from transactions
        const usedCategoryKeys = new Set<number>();

        // Add categories from transactions
        transactions.forEach((transaction) => {
          transaction.appuserTransactionCategories.forEach((category) => {
            usedCategoryKeys.add(category.categoryKey);
          });
        });

        // Get all categories (both parent and child) - excluding the artificial "Uncategorized"
        const allCategories = getAllCategories(categories);

        // Filter to only include categories that are used in transactions (excluding artificial "Uncategorized")
        const filteredCategories = allCategories.filter((category) => {
          // Skip the artificial "Uncategorized" category
          if (category.name === "Uncategorized") {
            return false;
          }
          return usedCategoryKeys.has(category.key);
        });

        return filteredCategories;
      }, [transactions, categories]);
      const transactionsCategoryOptions = useMemo(() => {
        const categoryOptions = transactionsCategories
          .map((category) => ({
            label: category.isSystemCategory
              ? t(getCategoryTranslationKey(category.name))
              : category.name,
            value: category.key.toString(),
          }))
          .toSorted((a, b) => a.label.localeCompare(b.label));

        // Check if there are any uncategorized transactions
        const hasUncategorizedTransactions = transactions.some(
          (transaction) =>
            transaction.appuserTransactionCategories.length === 0,
        );

        // Add "Uncategorized" option if there are transactions without categories
        if (hasUncategorizedTransactions) {
          categoryOptions.unshift({
            label: t("uncategorized"),
            value: "__uncategorized__",
          });
        }

        return categoryOptions;
      }, [t, transactionsCategories, transactions]);
      // Memoize expensive reduce operation
      const uniqueAccounts = useMemo(
        () =>
          Object.values(
            transactions.reduce<
              Record<
                Transaction["accountKey"]["accountKey"],
                Transaction["accountKey"]
              >
            >(
              (acc, { accountKey }) => ({
                ...acc,
                [accountKey.accountKey]: accountKey,
              }),
              {},
            ),
          ),
        [transactions],
      );
      const transactionsAccountsOptions = useMemo(
        () =>
          uniqueAccounts.map((account) => ({
            label: account.accountName,
            value: account.accountKey.toString(),
          })),
        [uniqueAccounts],
      );
      const transactionAccountDefaultOption = useMemo(
        () => (withAccountFilter ? undefined : transactionsAccountsOptions[0]),
        [withAccountFilter, transactionsAccountsOptions],
      );

      const transactionTypes = useMemo(
        () => [
          ...new Set(
            transactions
              .filter((t) => t.transactionTypeKey)
              .map((t) => t.transactionTypeKey!.name),
          ),
        ],
        [transactions],
      );
      const transactionTypesOptions = useMemo(
        () =>
          transactionTypes.map((transactionType) => ({
            label: t(`transaction-type-${transactionType}` as any),
            value: transactionType,
          })),
        [t, transactionTypes],
      );

      const [selectedTransactions, setSelectedTransactions] = useState<
        Transaction[]
      >([]);
      const tableRef = useRef<TableType<Transaction>>(null);
      const mobilePageSize = 10;
      const [mobilePageIndex, setMobilePageIndex] = useState(0);

      useEffect(() => {
        setMobilePageIndex(0);
        if (resetPagination) {
          setResetPagination(false);
        }
      }, [filteredTransactions.length, resetPagination]);

      const mobilePageCount = withPagination
        ? Math.max(1, Math.ceil(filteredTransactions.length / mobilePageSize))
        : 1;
      const safeMobilePageIndex = Math.min(
        mobilePageIndex,
        mobilePageCount - 1,
      );
      const mobileTransactions = withPagination
        ? filteredTransactions.slice(
            safeMobilePageIndex * mobilePageSize,
            safeMobilePageIndex * mobilePageSize + mobilePageSize,
          )
        : filteredTransactions;

      const onRowSelect = useCallback(
        (rows: Row<Transaction>[]) => {
          setSelectedTransactions(rows.map((row) => row.original));
        },
        [setSelectedTransactions],
      );

      const resetRowSelection = useCallback(() => {
        setSelectedTransactions([]);
        if (tableRef.current) {
          tableRef.current.resetRowSelection();
        }
      }, []);

      // Count active filters
      const activeFiltersCount = useMemo(() => {
        let count = 0;
        if (transactionTypeFilter.length > 0) count++;
        if (accountKeysFilter.length > 0) count++;
        if (transactionCategoryKeysFilter.length > 0) count++;
        if (needsReviewFilter) count++;
        return count;
      }, [
        transactionTypeFilter,
        accountKeysFilter,
        transactionCategoryKeysFilter,
        needsReviewFilter,
      ]);

      /*
       * RAD-579 — the server's count, trusted whenever the server applied the filters.
       *
       * RAD-576 had to withhold this the moment any filter was active, because the endpoint knew
       * nothing about account, type or category and pairing its honest 8,623 with a
       * browser-narrowed eight rows would have read as "8 of 8,623". Now that those filters are
       * server-side, the total describes exactly the list underneath it.
       *
       * Still withheld in browser-filtering mode, where the old mismatch is still real.
       */
      const serverTotalForFooter = filtersAppliedByServer
        ? serverTotal
        : activeFiltersCount === 0
          ? serverTotal
          : undefined;

      /*
       * The applied filters, one per selected value.
       *
       * These already existed but rendered as a bare `secondary` badge with
       * only the value on it — "Poupança", with nothing saying whether that
       * was an account, a merchant or a category. Each now carries its
       * dimension, and both render sites go through the shared FilterChip so
       * desktop and mobile stop drifting apart. § 9 FilterChip.
       */
      const activeFilterTags = useMemo(() => {
        const tags: Array<{
          dimension: string;
          label: string;
          onRemove: () => void;
          type: string;
        }> = [];

        // Transaction type filters
        transactionTypeFilter.forEach((typeValue) => {
          const option = transactionTypesOptions.find(
            (opt) => opt.value === typeValue,
          );
          if (option) {
            tags.push({
              label: option.label,
              onRemove: () =>
                onTransactionTypeFilterChange(
                  transactionTypeFilter.filter((t) => t !== typeValue),
                ),
              dimension: t("transaction-type"),
              type: "transaction-type",
            });
          }
        });

        // Account filters
        accountKeysFilter.forEach((accountValue) => {
          const option = transactionsAccountsOptions.find(
            (opt) => opt.value === accountValue,
          );
          if (option) {
            tags.push({
              label: option.label,
              onRemove: () =>
                onAccountKeyFilterChange(
                  accountKeysFilter.filter((a) => a !== accountValue),
                ),
              dimension: t("account"),
              type: "account",
            });
          }
        });

        // Category filters
        transactionCategoryKeysFilter.forEach((categoryValue) => {
          const option = transactionsCategoryOptions.find(
            (opt) => opt.value === categoryValue,
          );
          if (option) {
            tags.push({
              label: option.label,
              onRemove: () =>
                onCategoryKeyFilterChange(
                  transactionCategoryKeysFilter.filter(
                    (c) => c !== categoryValue,
                  ),
                ),
              dimension: t("category"),
              type: "category",
            });
          }
        });

        if (needsReviewFilter) {
          tags.push({
            dimension: t("filters"),
            label: t("transaction-review-filter"),
            onRemove: () => {
              setNeedsReviewFilter(false);
              setResetPagination(true);
            },
            type: "needs-review",
          });
        }

        return tags;
      }, [
        transactionTypeFilter,
        accountKeysFilter,
        transactionCategoryKeysFilter,
        transactionTypesOptions,
        transactionsAccountsOptions,
        transactionsCategoryOptions,
        onTransactionTypeFilterChange,
        onAccountKeyFilterChange,
        onCategoryKeyFilterChange,
        needsReviewFilter,
        t,
      ]);

      // Clear all filters
      const clearAllFilters = useCallback(() => {
        onTransactionTypeFilterChange([]);
        onAccountKeyFilterChange([]);
        onCategoryKeyFilterChange([]);
        setNeedsReviewFilter(false);
        onShowHiddenTransactionsChange?.(false);
        setResetPagination(true);
      }, [
        onTransactionTypeFilterChange,
        onAccountKeyFilterChange,
        onCategoryKeyFilterChange,
        onShowHiddenTransactionsChange,
      ]);

      const renderFilterControls = () => (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {t("transaction-review-filter")}
            </span>
            <Switch
              checked={needsReviewFilter}
              onCheckedChange={onNeedsReviewFilterChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {t("transaction-show-hidden-filter")}
            </span>
            <Switch
              checked={showHiddenTransactions}
              onCheckedChange={onShowHiddenTransactionsChange}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-sm font-medium">
              {t("transaction-type")}
            </span>
            <ComboBoxMulti
              className="w-full"
              key={`transaction-type-${transactionTypeFilter.join(",")}`}
              onSelect={(options) => {
                onTransactionTypeFilterChange(
                  options ? options.map((o) => o.value) : [],
                );
              }}
              defaultValue={transactionTypeFilter}
              options={transactionTypesOptions}
              withSearch={false}
              closeOnSelect={false}
              placeholder={t("select-transaction-type")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-sm font-medium">
              {t("account")}
            </span>
            <ComboBoxMulti
              className="w-full"
              key={`account-${accountKeysFilter.join(",")}`}
              onSelect={(options) => {
                onAccountKeyFilterChange(
                  options ? options.map((o) => o.value) : [],
                );
              }}
              defaultValue={
                accountKeysFilter.length > 0
                  ? accountKeysFilter
                  : transactionAccountDefaultOption
                    ? [transactionAccountDefaultOption.value]
                    : undefined
              }
              options={transactionsAccountsOptions}
              withSearch={false}
              closeOnSelect={false}
              placeholder={t("select-account")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-sm font-medium">
              {t("category")}
            </span>
            <ComboBoxMulti
              className="w-full"
              key={`category-${transactionCategoryKeysFilter.join(",")}`}
              onSelect={(options) => {
                onCategoryKeyFilterChange(
                  options ? options.map((o) => o.value) : [],
                );
              }}
              defaultValue={transactionCategoryKeysFilter}
              options={transactionsCategoryOptions}
              withSearch={false}
              closeOnSelect={false}
              placeholder={t("select-category")}
            />
          </div>
        </div>
      );

      const renderFilterTrigger = () => (
        <Button variant="secondary" size="sm" className="flex shrink-0 gap-2">
          <Filter className="size-3.5" />
          {t("filters")}
          {activeFiltersCount > 0 && (
            <Badge
              variant="secondary"
              className="h-5 min-w-5 rounded-full px-1.5 text-xs"
            >
              {activeFiltersCount}
            </Badge>
          )}
        </Button>
      );

      return (
        <>
          {withFilters && (
            <>
              {/* Desktop filters */}
              <div className="my-2 hidden flex-col gap-2 md:flex">
                <div className="flex items-center justify-between gap-3">
                  {transactionDateRange && onDateRangeFilterChange && (
                    <DatePickerRange
                      onSelect={onDateRangeFilterChange}
                      value={transactionDateRange}
                    />
                  )}

                  <Sheet>
                    <SheetTrigger asChild>{renderFilterTrigger()}</SheetTrigger>
                    <SheetContent
                      side="right"
                      className="flex w-full flex-col sm:max-w-md"
                    >
                      <SheetHeader>
                        <SheetTitle>{t("filters")}</SheetTitle>
                      </SheetHeader>
                      <div className="flex-1 overflow-y-auto py-2">
                        {renderFilterControls()}
                      </div>
                      {activeFiltersCount > 0 && (
                        <SheetFooter className="pt-4">
                          <Button
                            variant="outline"
                            onClick={clearAllFilters}
                            className="w-full"
                          >
                            {t("clear-all")}
                          </Button>
                        </SheetFooter>
                      )}
                    </SheetContent>
                  </Sheet>
                </div>

                {activeFiltersCount > 0 && activeFilterTags.length > 0 && (
                  <FilterChipBar>
                    {activeFilterTags.map((tag, index) => (
                      <FilterChip
                        key={`${tag.type}-${index}`}
                        label={tag.dimension}
                        value={tag.label}
                        onRemove={tag.onRemove}
                        removeLabel={t("filters-remove", {
                          name: tag.dimension,
                        })}
                      />
                    ))}
                  </FilterChipBar>
                )}
              </div>

              {/* Mobile filters */}
              <div className="flex flex-col gap-2 md:hidden">
                <div className="flex flex-row items-center justify-between gap-2">
                  {transactionDateRange && onDateRangeFilterChange && (
                    <DatePickerRange
                      onSelect={onDateRangeFilterChange}
                      value={transactionDateRange}
                    />
                  )}

                  <DrawerDialog
                    title={t("filters")}
                    trigger={renderFilterTrigger()}
                    footer={
                      activeFiltersCount > 0 ? (
                        <Button
                          variant="outline"
                          onClick={clearAllFilters}
                          className="w-full"
                        >
                          {t("clear-all")}
                        </Button>
                      ) : undefined
                    }
                  >
                    {renderFilterControls()}
                  </DrawerDialog>
                </div>

                {activeFilterTags.length > 0 && (
                  <FilterChipBar>
                    {activeFilterTags.map((tag, index) => (
                      <FilterChip
                        key={`${tag.type}-${index}`}
                        label={tag.dimension}
                        value={tag.label}
                        onRemove={tag.onRemove}
                        removeLabel={t("filters-remove", {
                          name: tag.dimension,
                        })}
                      />
                    ))}
                  </FilterChipBar>
                )}
              </div>
            </>
          )}
          <div className="hidden md:block">
            <Table
              columns={columnsWithSelect}
              data={filteredTransactions}
              withPagination={withPagination}
              withSelectRow={withSelectRow}
              withMultiSelectRow={withMultiSelectRow}
              onRowSelectionChange={onRowSelect}
              sticky={sticky}
              footerActions={footerActions}
              serverTotal={serverTotalForFooter}
              tableRef={tableRef}
              onRowClick={(row) => setInspectedTransaction(row.original)}
              meta={{
                getRowClasses: (row) => ({
                  "opacity-50": row.original.hidden,
                }),
              }}
            />
          </div>

          <InspectorDrawer
            open={inspectedTransaction !== null}
            onOpenChange={(open) => {
              if (!open) setInspectedTransaction(null);
            }}
            objectType={t("transaction")}
            // A transaction has no name, so its amount is its identity — the
            // one place § 9's value-as-title genuinely applies.
            title={
              inspectedTransaction ? (
                <Amount
                  value={
                    inspectedTransaction.editedSettlementAmount ??
                    inspectedTransaction.appuserSettlementAmount
                  }
                  currency={inspectedTransaction.appuserCurrencyKey.code}
                  className="font-mono"
                />
              ) : null
            }
            badges={
              inspectedTransaction?.hidden ? (
                <Badge variant="secondary">{t("transaction-hidden")}</Badge>
              ) : null
            }
            subtitle={
              inspectedTransaction?.transactionMerchantKey?.name ??
              inspectedTransaction?.description ??
              undefined
            }
            actions={
              inspectedTransaction ? (
                <Button
                  size="sm"
                  onClick={() => {
                    openEditTransactionModal(inspectedTransaction);
                    setInspectedTransaction(null);
                  }}
                >
                  <Pencil className="mr-2 size-3.5" />
                  {t("edit")}
                </Button>
              ) : null
            }
          >
            {inspectedTransaction ? (
              <PropertyList
                items={[
                  {
                    key: "date",
                    label: t("date"),
                    // The inspector is a detail surface, not a scanned column,
                    // so the year is always worth its characters here.
                    value: formatShortDate(inspectedTransaction.transactionDate, {
                      alwaysShowYear: true,
                    }),
                  },
                  {
                    key: "account",
                    label: t("account"),
                    value: inspectedTransaction.accountKey.accountName,
                  },
                  {
                    key: "description",
                    label: t("description"),
                    value: inspectedTransaction.description || "—",
                  },
                  {
                    key: "category",
                    label: t("category"),
                    value:
                      inspectedTransaction.appuserTransactionCategories[0]
                        ?.name ?? "—",
                  },
                  {
                    key: "balance",
                    label: t("balance"),
                    value: (
                      <Amount
                        value={inspectedTransaction.appuserCurrencyBalance}
                        currency={inspectedTransaction.appuserCurrencyKey.code}
                        className="font-mono"
                      />
                    ),
                  },
                ]}
              />
            ) : null}
          </InspectorDrawer>

          <MobileTransactionsList />
          {!!withMultiSelectRow && (
            <TransactionReviewControl
              transactions={selectedTransactions}
              onResetSelection={resetRowSelection}
            />
          )}
          {transactionData && (
            <>
              <AccountTransactionEditSheet
                transaction={transactionData}
                isOpen={editTransactionModalIsOpen}
                onFundGoal={(request) => {
                  setFundGoalTransaction(request);
                  closeEditTransactionModal();
                }}
                onOpenChange={(open) => {
                  if (!open) {
                    closeEditTransactionModal();
                  }
                }}
              />
              <AccountTransactionDeleteModal
                isOpen={deleteTransactionModalIsOpen}
                transaction={transactionData}
                closeModal={closeDeleteTransactionModal}
              />
            </>
          )}
          {fundGoalTransaction && (
            <FundTransactionFromGoalDialog
              currencyCode={fundGoalTransaction.currencyCode}
              isOpen
              maxAmount={fundGoalTransaction.maxAmount}
              onOpenChange={(open) => {
                if (!open) setFundGoalTransaction(null);
              }}
              transactionKey={fundGoalTransaction.transactionKey}
            />
          )}
        </>
      );
    },
  );

AccountTransactionsTable.displayName = "AccountTransactionsTable";

export default AccountTransactionsTable;
