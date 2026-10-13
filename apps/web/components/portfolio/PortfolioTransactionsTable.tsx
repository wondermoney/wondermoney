"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { CoinsIcon, Edit, Filter, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React, { useCallback, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";

import DatePickerRange from "@/components/ui/DatePickerRange";
import { Table } from "@/components/ui/Table";
import TableCellDate from "@/components/ui/Table/Cell/TableCellDate";
import TableCellDefault from "@/components/ui/Table/Cell/TableCellDefault";
import {
  isStockSplit,
  isTransactionItem,
  type PortfolioTransaction,
  type PortfolioTransactionItem,
} from "@/lib/api/portfolio/portfolioTransactionTypes";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { FinancialAssetLogo } from "../FinancialAssetLogo";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ComboBoxMulti } from "../ui/combobox-multi";
import { DrawerDialog } from "../ui/dialog-responsive";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import CellNumeric from "../ui/Table/Cell/CellNumeric";
import { Text } from "../ui/Typography";
import PortfolioTransactionDeleteModal from "./PortfolioTransactionDeleteModal";
import PortfolioTransactionEditModal from "./PortfolioTransactionEditModal";

interface PortfolioTransactionsTableProps {
  transactions: PortfolioTransaction[];
  withPortfolioFilter?: boolean;
  withTickerFilter?: boolean;
  withFilters?: boolean;
  transactionDateRange?: DateRange;
  setTransactionDateRange?: (dateRange?: DateRange) => void;
  footerActions?: React.ReactNode;
  sticky?: boolean;
  withPagination?: boolean;
}

const PortfolioTransactionsTable: React.FC<PortfolioTransactionsTableProps> =
  React.memo(
    ({
      transactions,
      withPortfolioFilter = true,
      withTickerFilter = true,
      withFilters = true,
      transactionDateRange,
      setTransactionDateRange,
      footerActions,
      sticky = true,
      withPagination = true,
    }) => {
      const t = useTranslations();
      const formatCurrency = useFormatCurrency();
      const posthog = usePostHog();
      const [resetPagination, setResetPagination] = useState(false);

      const transactionTypesOptions = useMemo(
        () => [
          { label: t("buy"), value: "buy" },
          { label: t("sell"), value: "sell" },
          { label: t("dividend"), value: "dividend" },
          { label: t("deposit"), value: "deposit" },
          { label: t("withdrawal"), value: "withdrawal" },
          { label: t("stock-split"), value: "stock_split" },
        ],
        [t],
      );

      const [transactionTypeFilter, setTransactionTypeFilter] = useState<
        string[]
      >([]);
      const [transactionTickerFilter, setTransactionTickerFilter] = useState<
        string[]
      >([]);
      const [transactionPortfolioFilter, setTransactionPortfolioFilter] =
        useState<string[]>([]);
      const [editingTransaction, setEditingTransaction] =
        useState<PortfolioTransactionItem | null>(null);
      const [deletingTransaction, setDeletingTransaction] =
        useState<PortfolioTransactionItem | null>(null);

      const transactionTickers = useMemo(
        () => [
          ...new Map(
            transactions.map((t) => [
              t.financialAssetKey.symbol,
              {
                symbol: t.financialAssetKey.symbol,
                logoUrl: t.financialAssetKey.logoUrl,
              },
            ]),
          ).values(),
        ],
        [transactions],
      );

      const transactionTickersOptions = useMemo(
        () =>
          transactionTickers.map(({ symbol, logoUrl }) => ({
            label: symbol,
            value: symbol,
            customRender: (
              <div className="flex items-center gap-2">
                {symbol.startsWith("CURRENCY_") ? (
                  <CoinsIcon />
                ) : logoUrl ? (
                  <FinancialAssetLogo symbol={symbol} logoUrl={logoUrl} />
                ) : null}
                <Text>{symbol.replace("CURRENCY_", "")}</Text>
              </div>
            ),
          })),
        [transactionTickers],
      );

      const transactionPortfolios = useMemo(
        () => [
          ...new Set(
            transactions.flatMap((t) =>
              t.portfolioKey ? [t.portfolioKey.name] : [],
            ),
          ),
        ],
        [transactions],
      );

      const filteredTransactions = useMemo(() => {
        let filtered = transactions;
        if (transactionTypeFilter.length > 0) {
          filtered = filtered.filter((item) =>
            isStockSplit(item)
              ? transactionTypeFilter.includes("stock_split")
              : transactionTypeFilter.includes(
                  item.financialTransactionTypeKey.name.toLowerCase(),
                ),
          );
        }
        if (transactionTickerFilter.length > 0) {
          filtered = filtered.filter((item) =>
            transactionTickerFilter.includes(item.financialAssetKey.symbol),
          );
        }
        if (transactionPortfolioFilter.length > 0) {
          filtered = filtered.filter((item) =>
            item.portfolioKey
              ? transactionPortfolioFilter.includes(item.portfolioKey.name)
              : false,
          );
        }
        return filtered;
      }, [
        transactions,
        transactionTypeFilter,
        transactionTickerFilter,
        transactionPortfolioFilter,
      ]);

      const onTransactionTypeFilterChange = useCallback(
        (transactionTypes: string[]) => {
          posthog.capture("portfolio_transaction_table_filter", {
            filter: "transaction_type",
          });
          setTransactionTypeFilter(transactionTypes);
          setResetPagination(true);
        },
        [posthog],
      );

      const onTransactionTickerFilterChange = useCallback(
        (tickers: string[]) => {
          posthog.capture("portfolio_transaction_table_filter", {
            filter: "transaction_ticker",
          });
          setTransactionTickerFilter(tickers);
          setResetPagination(true);
        },
        [posthog],
      );

      const onTransactionPortfolioFilterChange = useCallback(
        (portfolios: string[]) => {
          posthog.capture("portfolio_transaction_table_filter", {
            filter: "transaction_portfolio",
          });
          setTransactionPortfolioFilter(
            portfolios.includes("__all__")
              ? []
              : portfolios.filter((p) => p !== "__all__"),
          );
          setResetPagination(true);
        },
        [posthog],
      );

      const onDateRangeFilterChange = useCallback(
        (dateRange: DateRange | undefined) => {
          posthog.capture("portfolio_transaction_table_filter", {
            filter: "transaction_date",
          });
          setTransactionDateRange?.(dateRange);
          setResetPagination(true);
        },
        [posthog, setTransactionDateRange],
      );

      const columnHelper = useMemo(
        () => createColumnHelper<PortfolioTransaction>(),
        [],
      );
      const columns: ColumnDef<PortfolioTransaction, any>[] = useMemo(
        () => [
          columnHelper.accessor("transactionDate", {
            header: t("date"),
            cell: (info) => <TableCellDate value={info.getValue()} />,
          }),
          columnHelper.display({
            id: "type",
            header: t("type"),
            cell: ({ row }) =>
              isStockSplit(row.original) ? (
                <Badge
                  variant="secondary"
                  className="bg-muted text-muted-foreground"
                >
                  {t("stock-split")}
                </Badge>
              ) : (
                <TableCellDefault
                  value={t(
                    row.original.financialTransactionTypeKey.name.toLowerCase() as any,
                  )}
                />
              ),
          }),
          columnHelper.display({
            id: "ticker",
            header: t("ticker"),
            cell: ({ row }) => (
              <div className="flex items-center gap-2">
                {row.original.financialAssetKey.symbol.startsWith(
                  "CURRENCY_",
                ) ? (
                  <CoinsIcon />
                ) : row.original.financialAssetKey.logoUrl ? (
                  <FinancialAssetLogo
                    symbol={row.original.financialAssetKey.symbol}
                    logoUrl={row.original.financialAssetKey.logoUrl}
                  />
                ) : null}
                <Text>
                  {row.original.financialAssetKey.symbol.replace(
                    "CURRENCY_",
                    "",
                  )}
                </Text>
              </div>
            ),
          }),
          columnHelper.display({
            id: "quantity",
            header: () => <div className="text-right">{t("quantity")}</div>,
            cell: ({ row }) =>
              isStockSplit(row.original) ? (
                <CellNumeric className="text-right">
                  {t("split-ratio", {
                    ratio: `${row.original.numerator}:${row.original.denominator}`,
                  })}
                </CellNumeric>
              ) : isTransactionItem(row.original) &&
                (row.original.financialTransactionTypeKey.name === "DEPOSIT" ||
                  row.original.financialTransactionTypeKey.name ===
                    "WITHDRAWAL") ? null : (
                <CellNumeric className="text-right">
                  {isTransactionItem(row.original)
                    ? row.original.quantity
                    : null}
                </CellNumeric>
              ),
          }),
          columnHelper.display({
            id: "settlementUnitAmount",
            header: () => <div className="text-right">{t("unit-price")}</div>,
            cell: ({ row }) =>
              isStockSplit(row.original) ? null : isTransactionItem(
                  row.original,
                ) &&
                (row.original.financialTransactionTypeKey.name === "DEPOSIT" ||
                  row.original.financialTransactionTypeKey.name ===
                    "WITHDRAWAL") ? null : (
                <CellNumeric className="text-right">
                  {isTransactionItem(row.original)
                    ? formatCurrency(
                        Number(row.original.settlementUnitAmount),
                        row.original.settlementCurrencyKey.code,
                      )
                    : null}
                </CellNumeric>
              ),
          }),
          columnHelper.display({
            id: "settlementAmount",
            header: () => (
              <div className="text-right">{t("settlement-price")}</div>
            ),
            cell: ({ row }) =>
              isStockSplit(row.original) ? null : (
                <CellNumeric className="text-right">
                  {isTransactionItem(row.original)
                    ? formatCurrency(
                        Number(row.original.settlementAmount),
                        row.original.settlementCurrencyKey.code,
                      )
                    : null}
                </CellNumeric>
              ),
          }),
          columnHelper.display({
            id: "portfolio",
            header: t("portfolio"),
            cell: ({ row }) => (
              <TableCellDefault value={row.original.portfolioKey?.name ?? ""} />
            ),
          }),
          columnHelper.display({
            id: "actions",
            header: t("actions"),
            cell: ({ row }) =>
              isStockSplit(row.original) ? (
                <TableCellDefault value={t("automatic-corporate-action")} />
              ) : (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("edit-transaction")}
                    title={t("edit-transaction")}
                    onClick={() =>
                      isTransactionItem(row.original) &&
                      setEditingTransaction(row.original)
                    }
                  >
                    <Edit className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("delete-transaction")}
                    title={t("delete-transaction")}
                    onClick={() =>
                      isTransactionItem(row.original) &&
                      setDeletingTransaction(row.original)
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ),
          }),
        ],
        [columnHelper, formatCurrency, t],
      );

      const transactionPortfolioOptions = useMemo(
        () => [
          { label: t("all-portfolios"), value: "__all__" },
          ...transactionPortfolios.map((portfolio) => ({
            label: portfolio,
            value: portfolio,
          })),
        ],
        [transactionPortfolios, t],
      );
      const transactionPortfolioDefaultOption = useMemo(
        () =>
          withPortfolioFilter ? undefined : transactionPortfolioOptions[0],
        [withPortfolioFilter, transactionPortfolioOptions],
      );

      const activeFiltersCount = useMemo(
        () =>
          [
            transactionTypeFilter.length > 0,
            transactionTickerFilter.length > 0,
            transactionPortfolioFilter.length > 0,
          ].filter(Boolean).length,
        [
          transactionTypeFilter,
          transactionTickerFilter,
          transactionPortfolioFilter,
        ],
      );

      const activeFilterTags = useMemo(() => {
        const tags: Array<{
          label: string;
          onRemove: () => void;
          type: string;
        }> = [];

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
              type: "transaction-type",
            });
          }
        });

        transactionTickerFilter.forEach((tickerValue) => {
          const option = transactionTickersOptions.find(
            (opt) => opt.value === tickerValue,
          );
          if (option) {
            tags.push({
              label: option.label.replace("CURRENCY_", ""),
              onRemove: () =>
                onTransactionTickerFilterChange(
                  transactionTickerFilter.filter((t) => t !== tickerValue),
                ),
              type: "ticker",
            });
          }
        });

        transactionPortfolioFilter.forEach((portfolioValue) => {
          const option = transactionPortfolioOptions.find(
            (opt) => opt.value === portfolioValue,
          );
          if (option) {
            tags.push({
              label: option.label,
              onRemove: () =>
                onTransactionPortfolioFilterChange(
                  transactionPortfolioFilter.filter(
                    (p) => p !== portfolioValue,
                  ),
                ),
              type: "portfolio",
            });
          }
        });

        return tags;
      }, [
        transactionTypeFilter,
        transactionTickerFilter,
        transactionPortfolioFilter,
        transactionTypesOptions,
        transactionTickersOptions,
        transactionPortfolioOptions,
        onTransactionTypeFilterChange,
        onTransactionTickerFilterChange,
        onTransactionPortfolioFilterChange,
      ]);

      const clearAllFilters = useCallback(() => {
        onTransactionTypeFilterChange([]);
        onTransactionTickerFilterChange([]);
        onTransactionPortfolioFilterChange([]);
      }, [
        onTransactionTypeFilterChange,
        onTransactionTickerFilterChange,
        onTransactionPortfolioFilterChange,
      ]);

      const renderFilterControls = () => (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm font-medium">
              {t("transaction-type")}
            </p>
            <ComboBoxMulti
              className="w-full"
              key={`transaction-type-${transactionTypeFilter.join(",")}`}
              onSelect={(options) =>
                onTransactionTypeFilterChange(
                  options ? options.map((o) => o.value) : [],
                )
              }
              defaultValue={transactionTypeFilter}
              options={transactionTypesOptions}
              withSearch={false}
              closeOnSelect={false}
              placeholder={t("select-transaction-type")}
            />
          </div>
          {withTickerFilter && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm font-medium">
                {t("ticker")}
              </p>
              <ComboBoxMulti
                className="w-full"
                key={`ticker-${transactionTickerFilter.join(",")}`}
                onSelect={(options) =>
                  onTransactionTickerFilterChange(
                    options ? options.map((o) => o.value) : [],
                  )
                }
                defaultValue={transactionTickerFilter}
                options={transactionTickersOptions}
                withSearch={false}
                closeOnSelect={false}
                placeholder={t("select-ticker")}
              />
            </div>
          )}
          {withPortfolioFilter && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm font-medium">
                {t("portfolio")}
              </p>
              <ComboBoxMulti
                className="w-full"
                key={`portfolio-${transactionPortfolioFilter.join(",")}`}
                onSelect={(options) =>
                  onTransactionPortfolioFilterChange(
                    options ? options.map((o) => o.value) : [],
                  )
                }
                defaultValue={
                  transactionPortfolioFilter.length > 0
                    ? transactionPortfolioFilter
                    : transactionPortfolioDefaultOption
                      ? [transactionPortfolioDefaultOption.value]
                      : undefined
                }
                options={transactionPortfolioOptions}
                withSearch={false}
                closeOnSelect={false}
                placeholder={t("select-portfolio")}
              />
            </div>
          )}
        </div>
      );

      const renderFilterTrigger = () => (
        <Button variant="secondary" className="flex shrink-0 gap-2">
          <Filter className="size-4" />
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

      const renderActiveFilterTags = (className = "") =>
        activeFilterTags.length > 0 ? (
          <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
            {activeFilterTags.map((tag, index) => (
              <Badge
                key={`${tag.type}-${index}`}
                variant="secondary"
                className="gap-1 pr-1"
              >
                <span className="max-w-50 truncate">{tag.label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 hover:bg-transparent"
                  aria-label={t("remove-filter")}
                  onClick={tag.onRemove}
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            ))}
          </div>
        ) : null;

      return (
        <>
          {withFilters && (
            <>
              <div className="sticky top-16 z-10 my-2 hidden flex-col gap-3 md:flex">
                <div className="flex items-center justify-between gap-2">
                  {transactionDateRange && setTransactionDateRange && (
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
                {renderActiveFilterTags("hidden md:flex")}
              </div>
              <div className="flex flex-row items-center justify-between gap-2 md:hidden">
                {transactionDateRange && setTransactionDateRange && (
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
              {renderActiveFilterTags("md:hidden")}
            </>
          )}
          <div className="border-border bg-card border">
            <Table
              columns={columns}
              data={filteredTransactions}
              withPagination={withPagination}
              withScrollAffordance
              sticky={sticky}
              footerActions={footerActions}
            />
          </div>
          {editingTransaction && (
            <PortfolioTransactionEditModal
              isOpen={!!editingTransaction}
              closeModal={() => setEditingTransaction(null)}
              data={{
                portfolioId: Number(
                  editingTransaction.portfolioKey.portfolioKey,
                ),
                transactionId: editingTransaction.transactionKey,
                ticker: editingTransaction.financialAssetKey.symbol,
                quantity: editingTransaction.quantity,
                unitPrice: editingTransaction.settlementUnitAmount,
                transactionDate: new Date(
                  editingTransaction.transactionDate,
                ).toISOString(),
                financialTransactionTypeId: Number(
                  editingTransaction.financialTransactionTypeKey
                    .financialTransactionTypeKey,
                ),
                settlementCurrencyId: Number(
                  editingTransaction.settlementCurrencyKey.currencyKey,
                ),
                brokerId: editingTransaction.financialBrokerKey
                  ?.financialBrokerKey
                  ? Number(
                      editingTransaction.financialBrokerKey.financialBrokerKey,
                    )
                  : null,
                feeAmount: editingTransaction.feeAmount || null,
                feeCurrencyId: editingTransaction.feeCurrencyKey?.currencyKey
                  ? Number(editingTransaction.feeCurrencyKey.currencyKey)
                  : null,
                originalUnitPrice:
                  editingTransaction.originalUnitAmount || null,
                originalCurrencyId: editingTransaction.originalCurrencyKey
                  ?.currencyKey
                  ? Number(editingTransaction.originalCurrencyKey.currencyKey)
                  : null,
                notes: editingTransaction.notes ?? null,
              }}
            />
          )}
          {deletingTransaction && (
            <PortfolioTransactionDeleteModal
              isOpen={!!deletingTransaction}
              closeModal={() => setDeletingTransaction(null)}
              portfolioId={Number(
                deletingTransaction.portfolioKey.portfolioKey,
              )}
              transactionId={deletingTransaction.transactionKey}
              ticker={deletingTransaction.financialAssetKey.symbol}
            />
          )}
        </>
      );
    },
  );

PortfolioTransactionsTable.displayName = "PortfolioTransactionsTable";

export default PortfolioTransactionsTable;
