"use client";

import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import type { ChartConfig } from "@/components/ui/chart";
import {
  AreaLineChartBase,
  useChartFormatters,
} from "@/components/ui/charts";
import type { Goal, GoalSummary } from "@/lib/api/goals/types";
import {
  formatGoalCurrency,
  formatGoalDate,
  formatGoalInterestRate,
} from "@/lib/goals/format";
import { buildPayoffSeries } from "@/lib/goals/payoff";

interface DebtPayoffPanelProps {
  currencyCode?: string;
  goal: Goal;
  summary: GoalSummary;
}

function formatMonths(months: number, t: ReturnType<typeof useTranslations>) {
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(t("goals.debt-years", { count: years }));
  if (remaining > 0 || years === 0)
    parts.push(t("goals.debt-months", { count: remaining }));
  return parts.join(" ");
}

export default function DebtPayoffPanel({
  currencyCode,
  goal,
  summary,
}: DebtPayoffPanelProps) {
  const t = useTranslations();
  const { formatCompactCurrency } = useChartFormatters();
  const locale = useLocale();
  const projection = summary.debtProjection;

  const series = useMemo(
    () =>
      buildPayoffSeries({
        annualInterestRateBps: goal.annualInterestRateBps ?? 0,
        balance: projection?.currentBalance ?? goal.currentBalance ?? 0,
        monthlyPayment: projection?.monthlyPayment ?? 0,
      }),
    [goal.annualInterestRateBps, goal.currentBalance, projection],
  );

  const chartConfig = useMemo<ChartConfig>(
    () => ({ balance: { color: "var(--chart-1)", label: t("goals.debt-balance") } }),
    [t],
  );

  if (!projection) return null;

  const stats = [
    {
      label: t("goals.debt-payoff-date"),
      value:
        projection.paysOff && projection.payoffDate
          ? formatGoalDate(projection.payoffDate, locale)
          : t("goals.debt-never"),
    },
    {
      label: t("goals.debt-time-to-payoff"),
      value:
        projection.paysOff && projection.months !== null
          ? formatMonths(projection.months, t)
          : "—",
    },
    {
      label: t("goals.debt-total-interest"),
      value: formatGoalCurrency(projection.totalInterest, currencyCode, locale),
    },
    {
      label: t("goals.debt-monthly-payment"),
      value: formatGoalCurrency(projection.monthlyPayment, currencyCode, locale),
    },
  ];

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-foreground text-sm font-medium">
          {t("goals.debt-payoff-plan")}
        </h2>
        {goal.annualInterestRateBps != null && (
          <span className="text-muted-foreground font-mono text-xs">
            {formatGoalInterestRate(goal.annualInterestRateBps, locale)}{" "}
            {t("goals.debt-apr")}
          </span>
        )}
      </div>

      {!projection.paysOff && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive-text flex items-start gap-2 rounded-lg border p-3 text-xs"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("goals.debt-never-pays-off-hint")}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-muted/40 rounded-lg p-3">
            <dt className="text-muted-foreground text-xs">{stat.label}</dt>
            <dd className="text-foreground mt-1 font-mono text-sm font-semibold">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {series.length > 1 && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs">
            {t("goals.debt-payoff-timeline")}
          </p>
          <AreaLineChartBase
            data={series}
            xKey="month"
            series={[{ key: "balance", showDot: false, type: "area" }]}
            config={chartConfig}
            className="h-[240px]"
            showLegend={false}
            xFormatter={(value) =>
              t("goals.debt-month-short", { count: Number(value) })
            }
            yFormatter={(value) => formatCompactCurrency(value, currencyCode)}
          />
        </div>
      )}
    </Card>
  );
}
