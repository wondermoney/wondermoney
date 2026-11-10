"use client";

import { addMonths, format, subMonths } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import {
  BudgetMonthLead,
  MeasureKey,
} from "@/components/budget/BudgetMonthLead";
import { BudgetMonthNavigator } from "@/components/budget/BudgetMonthNavigator";
import BudgetOverviewTable from "@/components/budget/BudgetOverviewTable";
import BudgetTableMonth from "@/components/budget/BudgetTable";
import GoalsBudgetSection from "@/components/goals/GoalsBudgetSection";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import { useRouter } from "@/i18n/navigation";
import type { GetBudgetTemplateByYearResponse } from "@/lib/api/budget/useBudgetTemplateByYear";
import type { GetBudgetTemplateByYearAndMonthResponse } from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";
import { overPlanLines } from "@/lib/home/month-overview";
import {
  calculatePlannedAndSpentValue,
  convertBudgetTemplatesIntoRows,
} from "@/lib/utils/budget";
import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface BudgetMonthClientProps {
  budgetKey: number;
  year: number;
  month: number;
  budgetCategoriesData: GetBudgetTemplateByYearAndMonthResponse;
  budgetCategoriesYearlyData: GetBudgetTemplateByYearResponse;
}

export default function BudgetMonthClient({
  budgetKey,
  year,
  month,
  budgetCategoriesData,
  budgetCategoriesYearlyData,
}: BudgetMonthClientProps) {
  const t = useTranslations();
  const locale = useLocale();
  const formatCurrency = useFormatCurrency();
  const router = useRouter();

  const budgetDate = year && month ? new Date(year, month - 1, 1) : null;

  const hasPreviousMonth = !!budgetCategoriesData?.hasPreviousMonth;
  const navigateToPreviousMonth = () => {
    if (!budgetDate) return;
    const previousMonth = subMonths(budgetDate, 1);
    router.push(
      `/budgets/${budgetKey}/${previousMonth.getFullYear()}/${
        previousMonth.getMonth() + 1
      }`,
    );
  };
  const hasNextMonth = !!budgetCategoriesData?.hasNextMonth;
  const navigateToNextMonth = () => {
    if (!budgetDate) return;
    const nextMonth = addMonths(budgetDate, 1);
    router.push(
      `/budgets/${budgetKey}/${nextMonth.getFullYear()}/${
        nextMonth.getMonth() + 1
      }`,
    );
  };

  const data = useMemo(() => {
    if (!budgetCategoriesData) return null;
    return convertBudgetTemplatesIntoRows(
      budgetCategoriesData.budget.categories,
    );
  }, [budgetCategoriesData]);

  const {
    totalPlanned,
    totalAvailable,
    totalSpent,
    totalPercentage,
  }: {
    totalPlanned?: number;
    totalAvailable?: number;
    totalSpent?: number;
    totalPercentage?: number;
  } = useMemo(() => {
    if (!data) return {};

    return calculatePlannedAndSpentValue(data);
  }, [data]);

  const yearlyData = useMemo(() => {
    if (!budgetCategoriesYearlyData) return null;

    return convertBudgetTemplatesIntoRows(
      budgetCategoriesYearlyData.budget.categories,
    );
  }, [budgetCategoriesYearlyData]);

  const {
    totalPlanned: totalYearlyPlanned,
    totalSpent: totalYearlySpent,
    totalPercentage: _totalYearlyPercentage,
  }: {
    totalPlanned?: number;
    totalSpent?: number;
    totalPercentage?: number;
  } = useMemo(() => {
    if (!yearlyData) return {};

    return calculatePlannedAndSpentValue(yearlyData);
  }, [yearlyData]);

  const isTotalsDataReady =
    totalSpent !== undefined &&
    totalPlanned !== undefined &&
    totalAvailable !== undefined &&
    totalPercentage !== undefined;

  // Remaining is measured against what the month may spend: the plan plus
  // what rollover carried in.
  const totalMonthlySavings = isTotalsDataReady
    ? totalAvailable - totalSpent
    : undefined;

  const overviewData = useMemo(() => {
    if (
      !isTotalsDataReady ||
      totalYearlyPlanned === undefined ||
      totalYearlySpent === undefined
    )
      return;

    return [
      {
        name: t("month"),
        spent: totalSpent,
        budgeted: totalPlanned,
        remaining: totalAvailable - totalSpent,
        remainingPercentage: (totalAvailable - totalSpent) / totalAvailable,
      },
      {
        name: t("year"),
        spent: totalYearlySpent,
        budgeted: totalYearlyPlanned,
        remaining: totalYearlyPlanned - totalYearlySpent,
        remainingPercentage:
          (totalYearlyPlanned - totalYearlySpent) / totalYearlyPlanned,
      },
    ];
  }, [
    isTotalsDataReady,
    t,
    totalAvailable,
    totalPlanned,
    totalSpent,
    totalYearlyPlanned,
    totalYearlySpent,
  ]);

  if (totalMonthlySavings === undefined) {
    return null;
  }

  return (
    <>
      <div className="my-6 flex flex-col gap-6">
        <BudgetMonthNavigator
          label={
            budgetDate
              ? `${format(budgetDate, "LLLL", { locale: getDateFnsLocale(locale) })} ${budgetDate.getFullYear()}`
              : null
          }
          hasPreviousMonth={hasPreviousMonth}
          hasNextMonth={hasNextMonth}
          onPreviousMonth={navigateToPreviousMonth}
          onNextMonth={navigateToNextMonth}
        />
        <BudgetMonthLead
          monthName={
            budgetDate
              ? format(budgetDate, "LLLL", { locale: getDateFnsLocale(locale) })
              : ""
          }
          // Both are defined here: the early return above covers undefined.
          planned={totalPlanned ?? 0}
          available={totalAvailable ?? 0}
          spent={totalSpent ?? 0}
          overPlanCount={data ? overPlanLines(data).length : 0}
          currency={budgetCategoriesData.budget.currencyCode}
        />
        <UnconvertedAmountsNotice
          completeness={budgetCategoriesData.completeness}
        />
        {budgetCategoriesData.rolloverComplete === false ? (
          <p role="note" className="text-muted-foreground text-sm">
            {t("budgetPage.rollover-incomplete-month")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <div className="border-foreground flex min-h-96 flex-col justify-center gap-3 border-t-2 pt-2">
          <BudgetTableMonth
            budget={data ?? []}
            budgetKey={budgetKey}
            // Edits and deletes apply to the month on screen, which can be in next year.
            year={year}
            month={month}
            view="month"
            currency={budgetCategoriesData.budget.currencyCode}
            footerData={
              isTotalsDataReady
                ? {
                    totalPlanned: formatCurrency(
                      totalPlanned,
                      budgetCategoriesData.budget.currencyCode,
                    ),
                    totalSpent: formatCurrency(
                      totalSpent,
                      budgetCategoriesData.budget.currencyCode,
                    ),
                    totalPercentage,
                  }
                : undefined
            }
          />
          <MeasureKey />
        </div>
        <div className="bg-background flex min-h-36 flex-col justify-center">
          {overviewData && budgetCategoriesData ? (
            <BudgetOverviewTable
              data={overviewData}
              currency={budgetCategoriesData.budget.currencyCode}
            />
          ) : null}
          <UnconvertedAmountsNotice
            completeness={budgetCategoriesYearlyData?.completeness}
            className="mt-2"
          />
        </div>
        <GoalsBudgetSection />
      </div>
    </>
  );
}
