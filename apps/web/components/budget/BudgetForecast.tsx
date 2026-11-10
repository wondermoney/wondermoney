"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import type { ChartConfig } from "@/components/ui/chart";
import { BarChartBase, niceTicks } from "@/components/ui/charts";
import DataLoadError from "@/components/ui/DataLoadError";
import { RowsSkeleton, Section } from "@/components/ui/RuledSection";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import useBudgetForecast, {
  BUDGET_FORECAST_MONTHS,
  type BudgetForecastMonth,
  type BudgetForecastMonths,
  type GetBudgetForecastResponse,
} from "@/lib/api/budget/useBudgetForecast";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

/**
 * The budget's next months: what each plans, what the current one has spent
 * so far, what recurring items are expected to take, and what is left of the
 * planned income. Only the current month's "spent" is actual; every other
 * figure is a projection, and the section says what it rests on.
 */
export default function BudgetForecast({ budgetKey }: { budgetKey: number }) {
  const t = useTranslations("budgetForecast");
  const [months, setMonths] = useState<BudgetForecastMonths>(6);
  const query = useBudgetForecast({ budgetKey, months });

  return (
    <Section
      id="budget-forecast"
      title={t("title")}
      busy={query.isPending}
      aside={
        <div
          role="group"
          aria-label={t("months-label")}
          className="flex gap-1"
        >
          {BUDGET_FORECAST_MONTHS.map((option) => (
            <Button
              key={option}
              size="xs"
              variant={option === months ? "default" : "outline"}
              aria-pressed={option === months}
              onClick={() => setMonths(option)}
            >
              {t("months-option", { count: option })}
            </Button>
          ))}
        </div>
      }
    >
      {query.isPending ? (
        <RowsSkeleton rows={months} />
      ) : query.isError ? (
        <DataLoadError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <BudgetForecastView forecast={query.data} />
      )}
    </Section>
  );
}

export function BudgetForecastView({
  forecast,
}: {
  forecast: GetBudgetForecastResponse;
}) {
  const t = useTranslations("budgetForecast");
  const locale = useLocale();
  const formatCurrency = useFormatCurrency();
  const currency = forecast.currencyCode;
  const monthName = (month: BudgetForecastMonth, style: "long" | "short") =>
    new Intl.DateTimeFormat(locale, {
      month: style,
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(month.year, month.month - 1, 1)));
  const asOf = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${forecast.asOf}T00:00:00Z`));
  const recurringCount = forecast.basis.recurringItems.length;
  const incomplete = forecast.months.some((month) => !month.complete);

  const chartData = forecast.months.map((month) => ({
    label: monthName(month, "short"),
    income: month.income,
    expectedSpend: month.expectedSpend,
  }));
  const values = chartData.flatMap((row) => [row.income, row.expectedSpend]);
  const yTicks = niceTicks(0, Math.max(0, ...values), 5);
  const chartConfig = {
    income: { label: t("planned-income"), color: "var(--chart-1)" },
    expectedSpend: { label: t("expected-spending"), color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const money = (value: unknown) =>
    formatCurrency(Number(value), currency, {
      notation: "standard",
      maximumFractionDigits: 0,
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground max-w-prose text-sm">
          {t("basis", { count: recurringCount, date: asOf })}
        </p>
        {incomplete ? (
          <p role="note" className="text-muted-foreground text-sm">
            {t("incomplete", {
              currencies: new Intl.ListFormat(locale, {
                style: "long",
                type: "conjunction",
              }).format(forecast.completeness.unconvertedCurrencies ?? []),
              count: forecast.completeness.unconvertedCurrencies?.length ?? 0,
            })}
          </p>
        ) : null}
      </div>

      <figure className="flex flex-col gap-2">
        <BarChartBase
          data={chartData}
          keys={["income", "expectedSpend"]}
          xKey="label"
          config={chartConfig}
          className="h-[260px] md:h-[320px]"
          yTicks={yTicks}
          tooltipFormatter={money}
          yFormatter={money}
        />
        <figcaption className="text-muted-foreground text-xs">
          {t("chart-caption")}
        </figcaption>
      </figure>

      <div className="overflow-x-auto">
        <SimpleTable>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead className="text-right">{t("planned")}</TableHead>
              <TableHead className="text-right">{t("carried")}</TableHead>
              <TableHead className="text-right">{t("spent-so-far")}</TableHead>
              <TableHead className="text-right">
                {t("recurring-projected")}
              </TableHead>
              <TableHead className="text-right">
                {t("expected-spending")}
              </TableHead>
              <TableHead className="text-right">
                {t("planned-income")}
              </TableHead>
              <TableHead className="text-right">{t("net")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {forecast.months.map((month) => (
              <TableRow key={`${month.year}-${month.month}`}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="whitespace-nowrap">
                      {monthName(month, "long")}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {month.kind === "current"
                        ? t("kind-current")
                        : t("kind-future")}
                      {month.complete ? null : ` · ${t("month-incomplete")}`}
                    </span>
                  </div>
                </TableCell>
                <TableCell variant="numeric" className="text-right">
                  <Amount value={month.budgeted} currency={currency} />
                </TableCell>
                <TableCell variant="numeric" className="text-right">
                  <Amount
                    value={month.carriedIn === 0 ? null : month.carriedIn}
                    currency={currency}
                    tone="threshold"
                  />
                </TableCell>
                <TableCell variant="numeric" className="text-right">
                  {/* Only the current month has spending; a future one shows a dash, never a 0. */}
                  <Amount value={month.spent} currency={currency} />
                </TableCell>
                <TableCell
                  variant="numeric"
                  className="text-muted-foreground text-right"
                >
                  <Amount value={month.projectedSpend} currency={currency} />
                </TableCell>
                <TableCell variant="numeric" className="text-right">
                  <Amount value={month.expectedSpend} currency={currency} />
                </TableCell>
                <TableCell variant="numeric" className="text-right">
                  <Amount value={month.income} currency={currency} />
                </TableCell>
                <TableCell
                  variant="numeric"
                  className={cn("text-right font-medium")}
                >
                  <Amount value={month.net} currency={currency} tone="threshold" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SimpleTable>
      </div>

      {recurringCount > 0 ? (
        <details className="text-sm">
          <summary className="text-foreground cursor-pointer font-medium">
            {t("recurring-items", { count: recurringCount })}
          </summary>
          <ul className="mt-2 flex flex-col">
            {forecast.basis.recurringItems.map((item) => (
              <li
                key={item.recurringSeriesKey}
                className="border-border flex items-baseline justify-between gap-4 border-b py-2"
              >
                <span>
                  {item.name}
                  <span className="text-muted-foreground">
                    {" · "}
                    {t(`cadence.${item.cadence}`)}
                  </span>
                </span>
                <Amount
                  value={item.amount}
                  currency={currency}
                  className="font-mono"
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
