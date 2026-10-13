"use client";

import { ChevronDown, ChevronRight, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import type { NetWorth } from "@/lib/api/net-worth/useNetWorth";
import { cn } from "@/lib/utils";
import { getAmountClassName } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface DashboardNetworthTableProps {
  netWorth?: NetWorth;
  isLoading?: boolean;
  isError?: boolean;
}

type NetWorthRow = NonNullable<NetWorth["rows"]>[number];
type NetWorthTreeRow = Omit<NetWorthRow, "subRows"> & {
  subRows?: NetWorthTreeRow[];
};
type NetWorthDisplayRow = Omit<NetWorthTreeRow, "subRows"> & {
  balance: number;
  subRows: NetWorthDisplayRow[];
};

interface NetWorthListProps {
  rows: NetWorthDisplayRow[];
  currencyCode: string;
  totalBalance: number;
}

function NetWorthList({ rows, currencyCode, totalBalance }: NetWorthListProps) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  const formatPercentage = useFormatPercentage();
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // A share of net worth is only meaningful against a pool of the same sign.
  // This used to be `Math.abs(balance) / Math.abs(totalBalance)` — a double
  // absolute — so an account that *reduced* net worth reported a positive
  // share of it, and the column did not add up: two accounts of -121.61 and
  // 11,250.00 against a net worth of 11,128.39 read "1.1% of total" and
  // "101.1% of total". Assets are now measured against total assets and debts
  // against total debts, so each pool sums to 100% and neither can exceed it.
  const { totalAssets, totalDebts } = useMemo(() => {
    let assets = 0;
    let debts = 0;
    for (const row of rows) {
      if (row.balance >= 0) assets += row.balance;
      else debts += Math.abs(row.balance);
    }
    return { totalAssets: assets, totalDebts: debts };
  }, [rows]);

  const getShare = useCallback(
    (balance: number) => {
      const pool = balance >= 0 ? totalAssets : totalDebts;
      if (pool === 0) return 0;
      return Math.abs(balance) / pool;
    },
    [totalAssets, totalDebts],
  );

  // The denominator is named, because "1.1% of total" against a negative
  // balance was not wrong-looking enough for anyone to catch it.
  const getShareLabel = useCallback(
    (balance: number) =>
      balance >= 0 || totalDebts === 0 ? t("of-assets") : t("of-debts"),
    [t, totalDebts],
  );

  const toggleRow = useCallback((rowKey: string) => {
    setExpandedRows((current) => ({
      ...current,
      [rowKey]: !current[rowKey],
    }));
  }, []);

  const renderRows = (
    displayRows: NetWorthDisplayRow[],
    path = "",
    depth = 0,
  ): ReactNode =>
    displayRows.map((row, index) => {
      const rowPath = path
        ? `${path}.${index}:${row.key}`
        : `${index}:${row.key}`;
      const childrenId = `networth-children-${rowPath.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      const hasChildren = row.subRows.length > 0;
      const isExpanded = Boolean(expandedRows[rowPath]);
      // A level, not a delta: each row already carries "of assets" / "of
      // debts" in words beside the figure, and the minus sign says the rest.
      const balanceClassName = getAmountClassName();

      return (
        <div key={rowPath}>
          <div
            className={cn(
              "hover:bg-muted/50 flex items-center justify-between gap-3 px-5 py-3.5 transition-colors",
              depth > 0 && "pl-10",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Wallet className="text-muted-foreground size-4" />
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      row.isLiability && "text-destructive-text",
                    )}
                  >
                    {row.label}
                  </p>

                  {hasChildren ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="size-7 shrink-0 p-0"
                      aria-label={
                        isExpanded ? t("collapse-row") : t("expand-row")
                      }
                      aria-expanded={isExpanded}
                      aria-controls={childrenId}
                      onClick={() => toggleRow(rowPath)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div
                className={cn(
                  "font-mono text-sm font-medium",
                  balanceClassName,
                )}
              >
                <Amount value={row.balance} currency={row.currencyCode ?? currencyCode} />
              </div>
              <p className="text-muted-foreground text-xs leading-tight">
                (
                <span className="font-mono">
                  {formatPercentage(getShare(row.balance), {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                </span>{" "}
                {getShareLabel(row.balance)})
              </p>
            </div>
          </div>

          {hasChildren && isExpanded ? (
            <div
              id={childrenId}
              role="group"
              className="bg-muted/30 divide-border mx-5 mt-2 mb-3 divide-y overflow-hidden rounded-lg"
            >
              {renderRows(row.subRows, rowPath, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });

  return (
    <div className="divide-border divide-y">{renderRows(rows)}</div>
  );
}

const DashboardNetworthTable = ({
  netWorth,
  isLoading,
  isError,
}: DashboardNetworthTableProps) => {
  const t = useTranslations();

  const data = useMemo<NetWorthDisplayRow[]>(() => {
    const normalizeRow = (row: NetWorthTreeRow): NetWorthDisplayRow => ({
      ...row,
      balance: row.isLiability ? -Math.abs(row.amount) : row.amount,
      subRows: (row.subRows ?? []).map(normalizeRow),
    });

    return ((netWorth?.rows ?? []) as NetWorthTreeRow[]).map(normalizeRow);
  }, [netWorth]);

  if (isLoading && data.length === 0) {
    return (
      <div className="text-muted-foreground px-4 py-6 text-sm">
        {t("loading")}
      </div>
    );
  }

  if (isError && data.length === 0) {
    return (
      <div className="text-muted-foreground px-4 py-6 text-sm">
        {t("error")}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground px-4 py-6 text-sm">
        {t("unavailable")}
      </div>
    );
  }

  return (
    <NetWorthList
      rows={data}
      currencyCode={netWorth?.currencyCode ?? "EUR"}
      totalBalance={netWorth?.netWorth ?? 0}
    />
  );
};

export default DashboardNetworthTable;
