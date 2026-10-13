"use client";

import { TrendingDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ChartConfig } from "@/components/ui/chart";
import { BarChartBase } from "@/components/ui/charts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import useAccounts from "@/lib/api/account/useAccounts";
import type { StrategyResult } from "@/lib/api/goals/types";
import useDebtStrategy from "@/lib/api/goals/useDebtStrategy";
import { formatGoalCurrency } from "@/lib/goals/format";

function formatMonths(months: number, t: ReturnType<typeof useTranslations>) {
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(t("goals.debt-years", { count: years }));
  if (remaining > 0 || years === 0)
    parts.push(t("goals.debt-months", { count: remaining }));
  return parts.join(" ");
}

function StrategyChart({
  currencyCode,
  locale,
  names,
  strategy,
  t,
}: {
  currencyCode?: string;
  locale: string;
  names: Map<number, string>;
  strategy: StrategyResult;
  t: ReturnType<typeof useTranslations>;
}) {
  const data = strategy.order.map((id) => {
    const perDebt = strategy.perDebt.find((debt) => debt.id === id);
    return {
      interest: perDebt?.totalInterest ?? 0,
      name: names.get(id) ?? `#${id}`,
    };
  });

  const config: ChartConfig = {
    interest: { color: "var(--chart-1)", label: t("goals.debt-total-interest") },
  };

  return (
    <BarChartBase
      data={data}
      xKey="name"
      keys={["interest"]}
      config={config}
      className="h-[240px]"
      yFormatter={(value) => formatGoalCurrency(value, currencyCode, locale)}
      tooltipValueFormatter={(value) =>
        formatGoalCurrency(Number(value), currencyCode, locale)
      }
    />
  );
}

export default function DebtStrategySection() {
  const t = useTranslations();
  const locale = useLocale();
  const { data } = useDebtStrategy();
  const { data: accountsData } = useAccounts();
  const currencyCode =
    accountsData?.accounts[0]?.accountOwnerAppuserKey.currencyKey.code;

  const names = useMemo(
    () => new Map((data?.debts ?? []).map((debt) => [debt.id, debt.name])),
    [data?.debts],
  );

  if (!data?.avalanche || !data.snowball || data.debts.length < 2) return null;

  const { avalanche, snowball } = data;
  const interestSaved = snowball.totalInterest - avalanche.totalInterest;

  const cards = [
    { key: "avalanche" as const, strategy: avalanche },
    { key: "snowball" as const, strategy: snowball },
  ];

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-1">
        <h2 className="text-foreground text-lg font-semibold">
          {t("goals.debt-strategy-title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("goals.debt-strategy-subtitle")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map(({ key, strategy }) => {
          const isCheaper = strategy.totalInterest <= Math.min(avalanche.totalInterest, snowball.totalInterest);
          return (
            <div
              key={key}
              className="bg-muted/40 space-y-2 rounded-lg p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-foreground text-sm font-medium">
                  {t(`goals.debt-strategy-${key}`)}
                </h3>
                {isCheaper && interestSaved !== 0 && (
                  <Badge variant="success" className="gap-1">
                    <TrendingDown className="size-3" aria-hidden="true" />
                    {t("goals.debt-strategy-recommended")}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {t(`goals.debt-strategy-${key}-hint`)}
              </p>
              <dl className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t("goals.debt-time-to-payoff")}
                  </dt>
                  <dd className="text-foreground font-mono text-sm font-semibold">
                    {formatMonths(strategy.months, t)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t("goals.debt-total-interest")}
                  </dt>
                  <dd className="text-foreground font-mono text-sm font-semibold">
                    {formatGoalCurrency(
                      strategy.totalInterest,
                      currencyCode,
                      locale,
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {interestSaved > 0 && (
        <p className="text-muted-foreground text-sm">
          {t("goals.debt-strategy-savings", {
            amount: formatGoalCurrency(interestSaved, currencyCode, locale),
          })}
        </p>
      )}

      <Tabs defaultValue="avalanche">
        <TabsList>
          <TabsTrigger value="avalanche">
            {t("goals.debt-strategy-avalanche")}
          </TabsTrigger>
          <TabsTrigger value="snowball">
            {t("goals.debt-strategy-snowball")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="avalanche" className="pt-3">
          <StrategyChart
            currencyCode={currencyCode}
            locale={locale}
            names={names}
            strategy={avalanche}
            t={t}
          />
        </TabsContent>
        <TabsContent value="snowball" className="pt-3">
          <StrategyChart
            currencyCode={currencyCode}
            locale={locale}
            names={names}
            strategy={snowball}
            t={t}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
}
