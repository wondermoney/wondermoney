"use client";

import {
  type ColumnDef,
  createColumnHelper,
  type Row,
} from "@tanstack/react-table";
import { AlertTriangle, CoinsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React, { useCallback, useMemo, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Table } from "@/components/ui/Table";
import TableCellDefault from "@/components/ui/Table/Cell/TableCellDefault";
import { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";
import { cn } from "@/lib/utils";
import { getDeltaClassName } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { FinancialAssetLogo } from "../FinancialAssetLogo";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import CellNumeric from "../ui/Table/Cell/CellNumeric";
import PortfolioHoldingDetailsModal from "./PortfolioHoldingDetailsModal";

// Gains are a delta against cost, so they keep their colour — but through
// the shared helper rather than a third private copy of the same ternary.
const getFinancialColor = getDeltaClassName;

const getAssetTypeBadgeColor = (type: string) => {
  if (type === "stock") return "orange";
  if (type === "etf" || type === "mutual fund") return "green";
  if (type === "crypto") return "purple";
  if (type === "bond") return "yellow";
  if (type === "loan") return "pink";
  if (type === "derivative") return "brown";
  if (type === "cash") return "blue";
  return "gray";
};

interface PortfolioHoldingsTableProps {
  transactions: PortfolioHolding[];
  portfolioId?: string;
}

const PortfolioHoldingsTable: React.FC<PortfolioHoldingsTableProps> =
  React.memo(({ transactions, portfolioId }) => {
    const t = useTranslations();
    const formatCurrency = useFormatCurrency();
    const posthog = usePostHog();

    const missingPricing = transactions.some((transaction) => {
      const assetType = transaction.financialAssetType.toLowerCase();
      // Cash and Savings Certificate holdings are valued without a market
      // price by design (cash is 1:1, CA is valued by accrual) — their
      // null currentPrice must not trigger the "waiting for prices" state.
      const isPricelessByDesign =
        assetType === "cash" || assetType === "savings certificate";
      return (
        !isPricelessByDesign &&
        (transaction.currentPrice == null ||
          transaction.currentValue == null ||
          transaction.allocation == null)
      );
    });
    const readinessNote = missingPricing
      ? t("portfolio-holdings-partial-note")
      : null;

    const [
      isPortfolioTransactionDetailsModalOpen,
      setIsPortfolioTransactionDetailsModalOpen,
    ] = useState(false);

    const [selectedHolding, setSelectedHolding] =
      useState<PortfolioHolding | null>(null);

    const onClosePortfolioTransactionDetailsModal = () => {
      posthog.capture("portfolio_holding_details_opened", {
        action: "close",
        ticker: selectedHolding?.financialAssetSymbol,
      });
      setIsPortfolioTransactionDetailsModalOpen(false);
      setSelectedHolding(null);
    };

    const onRowClick = useCallback(
      (row: Row<PortfolioHolding>) => {
        posthog.capture("portfolio_holdings_table_row_clicked", {
          ticker: row.original.financialAssetSymbol,
        });
        posthog.capture("portfolio_holding_details_opened", {
          action: "open",
          ticker: row.original.financialAssetSymbol,
        });
        setSelectedHolding(row.original);
        setIsPortfolioTransactionDetailsModalOpen(true);
      },
      [posthog],
    );

    const columnHelper = useMemo(
      () => createColumnHelper<PortfolioHolding>(),
      [],
    );

    // Memoize columns to prevent unnecessary table re-renders
    // https://github.com/TanStack/table/issues/4382#issuecomment-1801830220
    const columns: ColumnDef<PortfolioHolding, any>[] = useMemo(
      () => [
        columnHelper.accessor("financialAssetType", {
          header: t("type"),
          cell: (info) => (
            <Badge
              color={
                getAssetTypeBadgeColor(info.getValue().toLowerCase()) as any
              }
            >
              {t(info.getValue() as any)}
            </Badge>
          ),
        }),
        columnHelper.accessor("financialAssetSymbol", {
          header: t("ticker"),
          cell: (info) => (
            <div
              className={cn(
                "flex items-center gap-2",
                (info.row.original.isInvalid ||
                  info.row.original.quantity < 0) &&
                  "text-warning-text rounded-md px-2 py-1",
              )}
            >
              {info.getValue().startsWith("CURRENCY_") ? (
                <CoinsIcon />
              ) : info.row.original.financialAssetLogoUrl ? (
                <FinancialAssetLogo
                  symbol={info.getValue()}
                  logoUrl={info.row.original.financialAssetLogoUrl}
                />
              ) : null}
              <span className="text-foreground text-sm">
                {info.getValue().replace("CURRENCY_", "")}
              </span>
              {(info.row.original.isInvalid ||
                info.row.original.quantity < 0) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRowClick(info.row);
                  }}
                  className="border-warning-text/30 bg-background text-warning-text inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium"
                >
                  <AlertTriangle className="size-3" />
                  {t("invalid-quantity")}
                </button>
              )}
            </div>
          ),
        }),
        columnHelper.accessor("allocation", {
          header: () => <div className="min-w-[11rem]">{t("allocation")}</div>,
          cell: (info) => (
            <div className="flex min-w-[11rem] items-center gap-4">
              {info.getValue() != null ? (
                <>
                  <Progress
                    value={info.getValue() as any}
                    className="w-[100px]"
                  />
                  <span className="text-foreground font-mono text-sm font-semibold">
                    {Number(info.getValue()).toFixed(1)}%
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground text-sm leading-5">
                  {t("portfolio-holdings-allocation-pending")}
                </span>
              )}
            </div>
          ),
        }),
        columnHelper.accessor("quantity", {
          header: () => (
            <div className="min-w-[5rem] text-right">{t("quantity")}</div>
          ),
          cell: (info) =>
            info.row.original.financialAssetType.toLowerCase() ===
            "cash" ? null : (
              <TableCellDefault
                value={info.getValue()}
                className="min-w-[5rem] text-right font-mono"
              />
            ),
        }),
        columnHelper.accessor("averageBuyPrice", {
          header: () => (
            <div className="min-w-[7.5rem] text-right">
              {t("average-price")}
            </div>
          ),
          cell: (info) =>
            info.row.original.financialAssetType.toLowerCase() ===
            "cash" ? null : (
              <CellNumeric className="min-w-[7.5rem] text-right">
                <Amount value={info.getValue()} currency={info.row.original.currency} />
              </CellNumeric>
            ),
        }),
        columnHelper.accessor("currentValue", {
          header: () => (
            <div className="min-w-[7.5rem] text-right">
              {t("current-value")}
            </div>
          ),
          cell: (info) =>
            info.row.original.financialAssetType.toLowerCase() ===
            "cash" ? null : (
              <CellNumeric className="min-w-[7.5rem] text-right">
                {info.getValue() != null
                  ? formatCurrency(info.getValue(), info.row.original.currency)
                  : t("portfolio-holdings-value-pending")}
              </CellNumeric>
            ),
        }),
        columnHelper.accessor("currentPrice", {
          header: () => (
            <div className="min-w-[7.5rem] text-right">
              {t("current-price")}
            </div>
          ),
          cell: (info) =>
            // Savings Certificates are valued by accrual, not market price —
            // they have no currentPrice by design, so never show the
            // "waiting for prices" state for them (see the accrual panel in
            // the holding details modal for their actual valuation).
            info.row.original.financialAssetType.toLowerCase() ===
            "savings certificate" ? null : info.getValue() != null ? (
              <CellNumeric className="min-w-[7.5rem] text-right">
                <Amount value={info.getValue()} currency={info.row.original.currency} />
              </CellNumeric>
            ) : (
              <CellNumeric className="text-muted-foreground min-w-[7.5rem] text-right">
                {t("portfolio-holdings-price-pending")}
              </CellNumeric>
            ),
        }),
        columnHelper.accessor("unrealizedGains", {
          header: () => (
            <div className="min-w-[10rem] text-right whitespace-nowrap">
              {t("gain-loss")}
            </div>
          ),
          cell: (info) => {
            const gains = info.getValue();
            const gainsPercent = info.row.original.unrealizedGainsPercentage;
            if (gains == null)
              return (
                <CellNumeric className="text-muted-foreground min-w-[10rem] text-right whitespace-nowrap">
                  {t("portfolio-holdings-gains-pending")}
                </CellNumeric>
              );
            return (
              <CellNumeric
                className={cn(
                  "min-w-[10rem] text-right whitespace-nowrap",
                  getFinancialColor(gains),
                )}
              >
                <Amount value={gains} currency={info.row.original.currency} />
                {gainsPercent != null && (
                  <span className="ml-1 text-xs">
                    ({gainsPercent > 0 ? "+" : ""}
                    {gainsPercent.toFixed(1)}%)
                  </span>
                )}
              </CellNumeric>
            );
          },
        }),
      ],
      [columnHelper, formatCurrency, t, onRowClick],
    );

    return (
      <div className="bg-card">
        {readinessNote ? (
          <div className="border-border border-b px-5 py-3">
            <p className="text-muted-foreground text-xs leading-5">
              {readinessNote}
            </p>
          </div>
        ) : null}
        <Table
          columns={columns}
          data={transactions}
          onRowClick={onRowClick}
          withPagination
          withSorting
          withScrollAffordance
          sticky
          meta={{
            getRowClasses: () => ({ "border-b-0": true }),
          }}
        />
        <PortfolioHoldingDetailsModal
          isOpen={isPortfolioTransactionDetailsModalOpen}
          closeModal={onClosePortfolioTransactionDetailsModal}
          holding={selectedHolding}
          portfolioId={portfolioId}
        />
      </div>
    );
  });

PortfolioHoldingsTable.displayName = "PortfolioHoldingsTable";

export default PortfolioHoldingsTable;
