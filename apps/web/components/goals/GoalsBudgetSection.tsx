"use client";

import { useLocale, useTranslations } from "next-intl";

import GoalStatusBadge from "@/components/goals/GoalStatusBadge";
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
  return (
    goal.summary?.requiredMonthlyContribution ??
    goal.summary?.monthlyShortfall ??
    null
  );
}

function getStatusTranslationKey(status: string) {
  return `goals.status-${status.replace("_", "-")}`;
}

export default function GoalsBudgetSection() {
  const t = useTranslations();
  const locale = useLocale();
  const { data, isError, isLoading } = useGoals();
  const goals = data?.goals ?? [];

  if (isLoading || isError || goals.length === 0) return null;

  return (
    <section className="space-y-4">
      {/* V1 integrates Goals & Reserves into the monthly budget view only; yearly budget integration would duplicate this dense row-level table. */}
      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-foreground text-lg font-semibold tracking-tight">
            {t("goals.goals-reserves")}
          </h2>
          <Link href="/goals" className="inline-flex">
            <Button variant="outline" size="sm">
              {t("goals.view")}
            </Button>
          </Link>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full caption-bottom text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="py-3 pr-4 font-medium">{t("goals.goal")}</th>
                <th className="py-3 pr-4 text-right font-medium">
                  {t("goals.available")}
                </th>
                <th className="py-3 pr-4 text-right font-medium">
                  {t("goals.target")}
                </th>
                <th className="py-3 pr-4 text-right font-medium">
                  {t("goals.needed-this-month")}
                </th>
                <th className="py-3 pr-4 text-right font-medium">
                  {t("goals.assigned-this-month")}
                </th>
                <th className="py-3 pr-4 font-medium">{t("status")}</th>
                <th className="py-3 font-medium">{t("goals.action")}</th>
              </tr>
            </thead>
            <tbody>
              {goals.map((goal) => {
                const currency = getCurrencyCode(goal);
                const summary = goal.summary;
                return (
                  <tr key={goal.goalKey} className="border-b last:border-b-0">
                    <td className="text-foreground py-4 pr-4 align-top font-medium">
                      {goal.name}
                    </td>
                    <td className="py-4 pr-4 text-right align-top font-mono tabular-nums">
                      {formatAmount(summary?.availableAmount, currency, locale)}
                    </td>
                    <td className="py-4 pr-4 text-right align-top font-mono tabular-nums">
                      {formatAmount(goal.targetAmount, currency, locale)}
                    </td>
                    <td className="py-4 pr-4 text-right align-top font-mono tabular-nums">
                      {formatAmount(getNeededThisMonth(goal), currency, locale)}
                    </td>
                    <td className="py-4 pr-4 text-right align-top font-mono tabular-nums">
                      {formatAmount(
                        summary?.assignedThisMonth,
                        currency,
                        locale,
                      )}
                    </td>
                    <td className="py-4 pr-4 align-top">
                      <GoalStatusBadge
                        label={t(
                          getStatusTranslationKey(
                            summary?.status ?? goal.status,
                          ),
                        )}
                        status={summary?.status ?? goal.status}
                      />
                    </td>
                    <td className="py-4 align-top">
                      <Link
                        href={`/goals/${goal.goalKey}`}
                        className="text-foreground text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {t("goals.view")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 md:hidden">
          {goals.map((goal) => {
            const currency = getCurrencyCode(goal);
            const summary = goal.summary;
            return (
              <div key={goal.goalKey} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-foreground font-medium">{goal.name}</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t("goals.available")}:{" "}
                      <span className="font-mono tabular-nums">
                        {formatAmount(
                          summary?.availableAmount,
                          currency,
                          locale,
                        )}
                      </span>
                    </p>
                  </div>
                  <GoalStatusBadge
                    label={t(
                      getStatusTranslationKey(summary?.status ?? goal.status),
                    )}
                    status={summary?.status ?? goal.status}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">{t("goals.target")}</p>
                    <p className="font-mono tabular-nums">
                      {formatAmount(goal.targetAmount, currency, locale)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("goals.needed-this-month")}
                    </p>
                    <p className="font-mono tabular-nums">
                      {formatAmount(getNeededThisMonth(goal), currency, locale)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("goals.assigned-this-month")}
                    </p>
                    <p className="font-mono tabular-nums">
                      {formatAmount(
                        summary?.assignedThisMonth,
                        currency,
                        locale,
                      )}
                    </p>
                  </div>
                  <div className="flex items-end justify-end">
                    <Link
                      href={`/goals/${goal.goalKey}`}
                      className="text-foreground text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {t("goals.view")}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
