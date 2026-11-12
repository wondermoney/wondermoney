"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import { Button, buttonVariants } from "@/components/ui/button";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import { Measure } from "@/components/ui/Measure";
import {
  RowsSkeleton,
  Section,
  SectionEmpty,
} from "@/components/ui/RuledSection";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import type { BudgetFull } from "@/lib/api/budget/useBudgetsFull";
import useBudgetsFull from "@/lib/api/budget/useBudgetsFull";
import {
  type GetBudgetTemplateByYearAndMonthResponse,
  useBudgetTemplatesByYearAndMonth,
} from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";
import {
  formatMonthName,
  monthPosition,
  monthSummary,
  overPlanLines,
} from "@/lib/home/month-overview";
import { convertBudgetTemplatesIntoRows } from "@/lib/utils/budget";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

function BudgetMonthRow({
  budget,
  data,
  error,
  isPending,
  onRetry,
  href,
}: {
  budget: BudgetFull;
  data: GetBudgetTemplateByYearAndMonthResponse | undefined;
  error: Error | null;
  isPending: boolean;
  onRetry: () => void;
  href: string;
}) {
  const t = useTranslations("homeOverview.month");
  const formatCurrency = useFormatCurrency();
  const rows = useMemo(
    () =>
      data ? convertBudgetTemplatesIntoRows(data.budget.categories) : null,
    [data],
  );

  const name = (
    <h3 className="text-foreground text-base font-medium">
      <Link
        href={href}
        className="inline-flex min-h-11 items-center hover:underline lg:min-h-0"
      >
        {budget.name}
      </Link>
    </h3>
  );

  if (isPending) {
    return (
      <li className="border-border border-b py-4 first:pt-0">
        {name}
        <RowsSkeleton rows={1} />
      </li>
    );
  }

  if (error || !rows || !data) {
    return (
      <li className="border-border flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-4 first:pt-0">
        {name}
        <div className="text-muted-foreground flex items-center gap-4 text-sm">
          <p>{t("row-error")}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      </li>
    );
  }

  const currency = data.budget.currencyCode;
  const summary = monthSummary(rows);
  const overCount = overPlanLines(rows).length;
  const money = (value: number) => (
    <Amount value={value} currency={currency} className="font-mono" />
  );

  return (
    <li className="border-border grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-2 border-b py-4 first:pt-0">
      {name}
      <p className="flex items-baseline gap-2 text-right">
        <Amount
          value={summary.left}
          currency={currency}
          tone="threshold"
          className="font-mono text-lg font-medium"
        />
        <span className="text-muted-foreground text-sm">
          {summary.isOverspent ? t("overspent") : t("left")}
        </span>
      </p>
      <Measure
        className="col-span-2"
        spent={summary.spent}
        planned={summary.planned}
        scaleMax={Math.max(summary.spent, summary.planned)}
        label={t("measure-label", {
          name: budget.name,
          spent: formatCurrency(summary.spent, currency),
          planned: formatCurrency(summary.planned, currency),
        })}
      />
      <p className="text-muted-foreground col-span-2 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
        <span>
          {t.rich("spent-of", {
            spent: () => money(summary.spent),
            planned: () => money(summary.planned),
          })}
        </span>
        {overCount > 0 ? (
          <span className="text-destructive-text">
            {t("over-plan", { count: overCount })}
          </span>
        ) : null}
      </p>
      <UnconvertedAmountsNotice
        completeness={data.completeness}
        className="col-span-2"
      />
    </li>
  );
}

/**
 * Every budget the household keeps, one row each for the current month: what
 * is left, spent against planned, and how many categories are over plan.
 * Each month comes through the request and row conversion the budget month
 * screen uses, so the figures agree with it to the cent.
 */
export function ThisMonthSection() {
  const t = useTranslations("homeOverview");
  const locale = useLocale();
  const today = useMemo(() => new Date(), []);

  const budgetsQuery = useBudgetsFull();
  const budgets = useMemo(
    () => budgetsQuery.data?.budgets ?? [],
    [budgetsQuery.data],
  );
  // Each budget in its own current month, which its start day decides.
  const monthQueries = useBudgetTemplatesByYearAndMonth(
    budgets.map((budget) => ({
      budgetKey: budget.budgetKey,
      year: budget.year,
      month: budget.month,
    })),
  );

  const position = monthPosition(today);
  const aside = t("month.days-left", {
    days: position.daysLeft,
    month: formatMonthName(today, locale),
  });

  if (budgetsQuery.isPending) {
    return (
      <Section id="month-heading" title={t("month.title")} busy>
        <RowsSkeleton rows={2} />
      </Section>
    );
  }

  if (budgetsQuery.error) {
    return (
      <Section id="month-heading" title={t("month.title")}>
        <DataLoadError
          error={budgetsQuery.error}
          onRetry={() => void budgetsQuery.refetch()}
        />
      </Section>
    );
  }

  if (budgets.length === 0) {
    return (
      <Section id="month-heading" title={t("month.title")}>
        <SectionEmpty
          title={t("budget-empty.title")}
          body={t("budget-empty.body")}
          action={
            <Link
              href="/budgets"
              className={buttonVariants({ variant: "secondary" })}
            >
              {t("budget-empty.action")}
            </Link>
          }
        />
      </Section>
    );
  }

  return (
    <Section
      id="month-heading"
      title={t("month.title")}
      aside={aside}
      busy={monthQueries.some((query) => query.isPending)}
    >
      <ul className="flex flex-col">
        {budgets.map((budget, index) => {
          const query = monthQueries[index];
          return (
            <BudgetMonthRow
              key={budget.budgetKey}
              budget={budget}
              data={query?.data}
              error={query?.error ?? null}
              isPending={query?.isPending ?? true}
              onRetry={() => void query?.refetch()}
              href={`/budgets/${budget.budgetKey}/${budget.year}/${budget.month}`}
            />
          );
        })}
      </ul>
    </Section>
  );
}
