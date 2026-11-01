"use client";

import { addMonths, format, subMonths } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { BudgetMonthNavigator } from "@/components/budget/BudgetMonthNavigator";
import BudgetOverviewTable from "@/components/budget/BudgetOverviewTable";
import BudgetTableMonth from "@/components/budget/BudgetTable";
import GoalsBudgetSection from "@/components/goals/GoalsBudgetSection";
import { Amount } from "@/components/ui/Amount";
import { Text } from "@/components/ui/Typography";
import { useRouter } from "@/i18n/navigation";
import type { GetBudgetTemplateByYearResponse } from "@/lib/api/budget/useBudgetTemplateByYear";
import type { GetBudgetTemplateByYearAndMonthResponse } from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";
import { cn } from "@/lib/utils";
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
    totalSpent,
    totalPercentage,
  }: { totalPlanned?: number; totalSpent?: number; totalPercentage?: number } =
    useMemo(() => {
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
    totalPercentage !== undefined;

  const totalMonthlySavings = isTotalsDataReady
    ? totalPlanned - totalSpent
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
        remaining: totalPlanned - totalSpent,
        remainingPercentage: (totalPlanned - totalSpent) / totalPlanned,
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
      <div className="bg-background my-4 rounded-xl">
        <div className="flex flex-row items-center justify-between">
          <BudgetMonthNavigator
            label={
              budgetDate
                ? `${format(budgetDate, "LLL", { locale: getDateFnsLocale(locale) })} ${budgetDate.getFullYear()}`
                : null
            }
            hasPreviousMonth={hasPreviousMonth}
            hasNextMonth={hasNextMonth}
            onPreviousMonth={navigateToPreviousMonth}
            onNextMonth={navigateToNextMonth}
          />
          <div className="flex flex-col items-end p-4 pr-0">
            <Text
              variant="largeText"
              className={cn(
                "text-xl",
                totalMonthlySavings < 0
                  ? "text-destructive-text"
                  : "text-success-text",
              )}
            >
              <Amount value={totalMonthlySavings} currency={budgetCategoriesData.budget.currencyCode} />
            </Text>
            <Text variant="mutedText">
              {totalMonthlySavings < 0
                ? t("loss-monthly")
                : t("remaining-monthly")}
            </Text>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="bg-background flex min-h-96 flex-col justify-center">
          <BudgetTableMonth
            budget={data ?? []}
            budgetKey={budgetKey}
            year={new Date().getFullYear()}
            month={new Date().getMonth() + 1}
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
        </div>
        <div className="bg-background flex min-h-36 flex-col justify-center">
          {overviewData && budgetCategoriesData ? (
            <BudgetOverviewTable
              data={overviewData}
              currency={budgetCategoriesData.budget.currencyCode}
            />
          ) : null}
        </div>
        <GoalsBudgetSection />
      </div>
    </>
  );
}
