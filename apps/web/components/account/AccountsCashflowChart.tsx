"use client";

import { useTranslations } from "next-intl";
import React from "react";
import colors from "tailwindcss/colors";

import { BarChartBase, niceTicks } from "@/components/ui/charts";
import { AccountCashflow } from "@/lib/api/account/useAccountsCashflow";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { ChartConfig } from "../ui/chart";

export default function AccountsCashflowChart({
  currencyCode,
  data,
}: {
  currencyCode: string;
  data: AccountCashflow[];
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  const chartData = data
    .map((item) => ({
      month: new Date(item.date).toLocaleString("default", { month: "short" }),
      amount: item.amount,
    }))
    .toReversed();

  // Bars carry magnitude, so the scale has to include zero: left to itself
  // Recharts framed a single -€120 month as -122…-118 and the bar filled the
  // whole canvas with no baseline to read it against (RAD-615).
  const values = chartData.map((item) => item.amount);
  const yTicks = niceTicks(
    Math.min(0, ...values),
    Math.max(0, ...values),
    5,
  );

  const chartConfig = {
    amount: {
      label: t("amount"),
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;
  const getBarColor = (row: Record<string, unknown>, key: string) =>
    Number(row[key]) >= 0 ? colors.green[600] : "var(--destructive)";

  return (
    <BarChartBase
      data={chartData}
      keys={["amount"]}
      xKey="month"
      config={chartConfig}
      className="h-[300px] md:h-[400px]"
      getBarColor={getBarColor}
      yTicks={yTicks}
      tooltipFormatter={(value) =>
        formatCurrency(Number(value), currencyCode, {
          notation: "standard",
          maximumFractionDigits: 0,
        })
      }
      yFormatter={(value) =>
        formatCurrency(Number(value), currencyCode, {
          notation: "standard",
          maximumFractionDigits: 0,
        })
      }
    />
  );
}
