"use client";

import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/components/ui/Link";
import type { Goal } from "@/lib/api/goals/types";
import useGoals from "@/lib/api/goals/useGoals";
import { formatGoalCurrency } from "@/lib/goals/format";

function getCurrencyCode(goal: Goal) {
  return (
    goal.currencyCode ??
    (typeof goal.currencyKey === "object" && goal.currencyKey?.code
      ? goal.currencyKey.code
      : null)
  );
}

function formatAmount(
  value: number | null | undefined,
  currency: string | null,
  locale: string,
) {
  if (value === null || value === undefined) return "—";
  return formatGoalCurrency(value, currency, locale);
}

function getNeededThisMonth(goal: Goal) {
  // Show what's still outstanding this month (shortfall), not the static
  // monthly target — a fully funded goal should read 0, matching the goal
  // detail page's "Short by" stat.
  return goal.summary?.monthlyShortfall ?? null;
}

export default function DashboardGoalsCard() {
  const t = useTranslations();
  const locale = useLocale();
  const { data, isLoading } = useGoals();

  if (isLoading) return null;

  const goals = data?.goals ?? [];
  const activeGoals = goals.filter((goal) => goal.status === "active");
  const attentionGoals = goals.filter(
    (goal) => goal.summary?.status === "behind",
  );
  const highlightedGoals = [...attentionGoals, ...activeGoals].filter(
    (goal, index, list) =>
      list.findIndex((item) => item.goalKey === goal.goalKey) === index,
  );

  if (highlightedGoals.length === 0) return null;

  const previewGoals = highlightedGoals.slice(0, 3);
  const goalsWithNeeded = highlightedGoals.filter(
    (goal) => getNeededThisMonth(goal) !== null,
  );
  const currencies = goalsWithNeeded.map(getCurrencyCode);
  const knownCurrencies = currencies.filter((currency): currency is string =>
    Boolean(currency),
  );
  const uniqueCurrencies = [...new Set(knownCurrencies)];
  const sameCurrency =
    uniqueCurrencies.length === 1 &&
    knownCurrencies.length === goalsWithNeeded.length;
  const currency = sameCurrency ? uniqueCurrencies[0] : null;

  let monthlyNeeded: number | null = null;
  for (const goal of goalsWithNeeded) {
    const needed = getNeededThisMonth(goal);
    if (needed === null) continue;
    if (!currency) {
      monthlyNeeded = null;
      break;
    }
    monthlyNeeded = (monthlyNeeded ?? 0) + needed;
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-foreground text-sm font-semibold tracking-tight">
          {t("goals.dashboard-title")}
        </h2>
      </div>

      <Card className="border-border p-4 shadow-none">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs">
                {t("goals.dashboard-active")}
              </p>
              <p className="text-foreground mt-1 font-mono text-xl font-semibold tabular-nums">
                {String(activeGoals.length)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">
                {t("goals.dashboard-monthly-needed")}
              </p>
              <p className="text-foreground mt-1 font-mono text-xl font-semibold tabular-nums">
                {formatAmount(monthlyNeeded, currency, locale)}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {previewGoals.map((goal) => (
              <div
                key={goal.goalKey}
                className="flex items-start justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="text-foreground truncate text-sm font-medium">
                    {goal.name}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("goals.dashboard-needed-this-month")}
                  </p>
                </div>
                <p className="text-foreground font-mono text-sm font-semibold tabular-nums">
                  {formatAmount(
                    getNeededThisMonth(goal),
                    getCurrencyCode(goal),
                    locale,
                  )}
                </p>
              </div>
            ))}
          </div>

          <Link
            href="/goals"
            className="text-foreground focus-visible:ring-ring inline-flex w-fit rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
          >
            {t("goals.view-dashboard")}
          </Link>
        </div>
      </Card>
    </section>
  );
}
