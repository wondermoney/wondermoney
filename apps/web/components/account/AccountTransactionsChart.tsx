"use client";

import * as changeCase from "change-case";
import { startOfMonth } from "date-fns";
import { useTranslations } from "next-intl";
import React, { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import {
  ComposedAreaBarChartBase,
  useChartFormatters,
} from "@/components/ui/charts";
import { getAccountChartCurrencyCode } from "@/lib/account/account-display-logic";
import { buildAccountTransactionsChartData } from "@/lib/account/account-transactions-chart-data";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import type { ChartConfig } from "../ui/chart";

interface AccountTransactionsLineChartProps {
  currencyCode?: string;
  transactions: Transaction[];
  fromDate?: Date;
  toDate?: Date;
}

const AccountTransactionsChart: React.FC<AccountTransactionsLineChartProps> =
  React.memo(
    ({ currencyCode: displayCurrencyCode, transactions, fromDate, toDate }) => {
      const t = useTranslations();
      const { formatChartDate } = useChartFormatters();
      const formatCurrency = useFormatCurrency();
      const chartData = useMemo(
        () =>
          buildAccountTransactionsChartData({ transactions, fromDate, toDate }),
        [transactions, fromDate, toDate],
      );
      const currencyCode = useMemo(
        () =>
          getAccountChartCurrencyCode(
            transactions[0]!.accountKey.currencyKey.code,
            displayCurrencyCode,
          ),
        [displayCurrencyCode, transactions],
      );

      const chartConfig: ChartConfig = useMemo(
        () => ({
          balance: {
            label: t("balance"),
            color: "var(--chart-1)",
          },
          dailyAmount: {
            label: t("daily-amount"),
            color: "var(--chart-2)",
          },
        }),
        [t],
      );

      return (
        <ComposedAreaBarChartBase
          xKey="x"
          areaKeys={["balance"]}
          barKeys={["dailyAmount"]}
          data={chartData}
          config={chartConfig}
          className="h-[300px] md:h-[400px]"
          yFormatter={(value) =>
            formatCurrency(Number(value), currencyCode, {
              maximumFractionDigits: 0,
            })
          }
          xFormatter={(value) =>
            formatChartDate(value as string | number | Date)
          }
          tooltipFormatter={(value, name, item) => (
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor:
                      item.color || item.payload?.fill || "var(--chart-1)",
                  }}
                />
                <span className="text-muted-foreground">
                  {t(changeCase.kebabCase(String(name)))}
                </span>
              </div>
              <span className="font-mono font-medium tabular-nums">
                <Amount value={Number(value)} currency={currencyCode} />
              </span>
            </div>
          )}
        />
      );
    },
  );

AccountTransactionsChart.displayName = "AccountTransactionsChart";

export default AccountTransactionsChart;
