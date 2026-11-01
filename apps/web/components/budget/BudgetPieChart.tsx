"use client";

import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import type { ChartConfig } from "@/components/ui/chart";
import { PieChartBase } from "@/components/ui/charts";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { BudgetRow } from "./BudgetTableNew";

interface BudgetPieChartProps {
  data: BudgetRow[];
  currency?: string;
}

const BudgetPieChart = ({ data, currency = "EUR" }: BudgetPieChartProps) => {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  const shouldReduceMotion = useReducedMotion();

  // Calculate total budget for percentage calculation
  const totalBudget = data.reduce((sum, row) => sum + row.budgeted, 0);

  const chartData = useMemo(
    () =>
      data.map((row, index) => {
        // Calculate percentage (handle division by zero)
        const percentage =
          totalBudget > 0 ? Math.round((row.budgeted / totalBudget) * 100) : 0;

        return {
          chartKey: `category-${index}`,
          name: row.name,
          label: row.isSystemCategory
            ? t(getCategoryTranslationKey(row.name))
            : row.name,
          value: percentage,
          fill: row.bgColor,
          originalValue: row.budgeted, // Keep original value for tooltip
          originalFormattedValue: formatCurrency(row.budgeted, currency),
        };
      }),
    [data, currency, formatCurrency, t, totalBudget],
  );

  const chartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        chartData.map((item) => [
          item.chartKey,
          { label: item.label, color: item.fill },
        ]),
      ),
    [chartData],
  );

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader className="items-center pb-0">
        <CardTitle>{t("budget-distribution")}</CardTitle>
        <CardDescription>{t("category-breakdown")}</CardDescription>
      </CardHeader>
      <CardContent className="mt-2 flex-1 p-0">
        <PieChartBase
          data={chartData}
          config={chartConfig}
          nameKey="chartKey"
          valueKey="value"
          isAnimationActive={!shouldReduceMotion}
          className="mx-auto h-[280px] md:h-[320px]"
          tooltipFormatter={(value, name, item) => (
            <div className="flex w-full items-start justify-between gap-3">
              <div className="grid gap-0.5">
                <span className="text-muted-foreground">
                  {chartConfig[String(name)]?.label ??
                    item.payload?.label ??
                    name}
                </span>
                <span className="text-foreground font-mono tabular-nums">
                  {item.payload?.originalFormattedValue}
                </span>
              </div>
              <span className="text-muted-foreground font-mono font-medium tabular-nums">
                {Number(value).toFixed(1)}%
              </span>
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
};

export default BudgetPieChart;
