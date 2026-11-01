"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import React, { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Progress } from "@/components/ui/progress";
import { Table } from "@/components/ui/Table";
import CellNumeric from "@/components/ui/Table/Cell/CellNumeric";
import { type ColumnDef, createColumnHelper } from "@/components/ui/Table/features";
import type { PortfolioBreakdownItem } from "@/lib/api/portfolio/usePortfolioDashboard";
import { cn } from "@/lib/utils";
import { getDeltaClassName } from "@/lib/utils/formatCurrency";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface PortfolioBreakdownProps {
  portfolios: PortfolioBreakdownItem[];
}

// gainPercent is a delta — colour earns its place here. Shared helper.
const getFinancialColor = getDeltaClassName;

const PortfolioBreakdown: React.FC<PortfolioBreakdownProps> = ({
  portfolios,
}) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const formatCurrency = useFormatCurrency();
  const router = useRouter();

  const columnHelper = useMemo(
    () => createColumnHelper<PortfolioBreakdownItem>(),
    [],
  );

  const columns: ColumnDef<PortfolioBreakdownItem, any>[] = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: t("portfolio"),
        cell: (info) => (
          <span className="text-foreground text-sm font-medium">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("value", {
        header: () => <div className="text-right">{t("value")}</div>,
        cell: (info) => (
          <CellNumeric className="text-right">
            <Amount value={info.getValue()} currency={info.row.original.currency} />
          </CellNumeric>
        ),
      }),
      columnHelper.accessor("weight", {
        header: t("weight"),
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Progress value={info.getValue()} className="w-[80px]" />
            <span className="text-foreground font-mono text-sm font-medium">
              {formatPercentage(info.getValue() / 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor("gainPercent", {
        header: () => <div className="text-right">{t("gain")}</div>,
        cell: (info) => {
          const value = info.getValue();
          return (
            <CellNumeric
              className={cn("text-right font-medium", getFinancialColor(value))}
            >
              {formatPercentage(value / 100, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
                signDisplay: "exceptZero",
              })}
            </CellNumeric>
          );
        },
      }),
    ],
    [columnHelper, formatPercentage, t],
  );

  const handleRowClick = (row: any) => {
    router.push(`/portfolio/${row.original.portfolioKey}`);
  };

  if (portfolios.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[100px] items-center justify-center">
        {t("no-portfolios")}
      </div>
    );
  }

  return (
    <Table
      columns={columns}
      data={portfolios}
      onRowClick={handleRowClick}
      meta={{
        getRowClasses: () => ({ "border-b-0": true }),
      }}
    />
  );
};

export default PortfolioBreakdown;
