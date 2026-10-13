"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import BudgetOverviewTable from "@/components/budget/BudgetOverviewTable";
import BudgetTable from "@/components/budget/BudgetTable";
import Stats from "@/components/ui/Stats";
import type { GetBudgetTemplateByYearResponse } from "@/lib/api/budget/useBudgetTemplateByYear";
import type { GetBudgetTemplateByYearUntilMonthResponse } from "@/lib/api/budget/useBudgetTemplateByYearUntilMonth";
import {
  calculatePlannedAndSpentValue,
  convertBudgetTemplatesIntoRows,
} from "@/lib/utils/budget";
import { calculateStoredMonthlyEquivalentAnnualIncome } from "@/lib/utils/budget-wizard";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

interface BudgetYearClientProps {
  budgetKey: number;
  year: number;
  budgetCategoriesData: GetBudgetTemplateByYearResponse;
  budgetCategoriesUntilNowData: GetBudgetTemplateByYearUntilMonthResponse;
}

export default function BudgetYearClient({
  budgetKey,
  budgetCategoriesData,
  budgetCategoriesUntilNowData,
}: BudgetYearClientProps) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();

  const data = useMemo(() => {
    if (!budgetCategoriesData) return null;

    return convertBudgetTemplatesIntoRows(
      budgetCategoriesData.budget.categories,
    );
  }, [budgetCategoriesData]);

  const yearlyToDateData = useMemo(() => {
    if (!budgetCategoriesUntilNowData) return null;

    return convertBudgetTemplatesIntoRows(
      budgetCategoriesUntilNowData.budget.categories,
    );
  }, [budgetCategoriesUntilNowData]);

  const yearlyTotalIncome = calculateStoredMonthlyEquivalentAnnualIncome(
    budgetCategoriesData?.budget.incomes ?? [],
  );

  const {
    totalPlanned,
    totalSpent,
    totalPercentage,
  }: { totalPlanned?: number; totalSpent?: number; totalPercentage?: number } =
    useMemo(() => {
      if (!data) return {};

      return calculatePlannedAndSpentValue(data);
    }, [data]);

  const {
    totalPlanned: totalPlannedToDate,
    totalSpent: totalSpentToDate,
    totalPercentage: _totalPercentageToDate,
  }: {
    totalPlanned?: number;
    totalSpent?: number;
    totalPercentage?: number;
  } = useMemo(() => {
    if (!yearlyToDateData) return {};

    return calculatePlannedAndSpentValue(yearlyToDateData);
  }, [yearlyToDateData]);

  const isTotalsDataReady =
    totalSpent !== undefined &&
    totalPlanned !== undefined &&
    totalPercentage !== undefined;

  const totalYearlySavings = isTotalsDataReady
    ? yearlyTotalIncome - totalPlanned
    : undefined;

  const overviewData = useMemo(() => {
    if (
      !isTotalsDataReady ||
      totalPlannedToDate === undefined ||
      totalSpentToDate === undefined
    )
      return;

    return [
      {
        name: t("year-to-date"),
        spent: totalSpentToDate,
        budgeted: totalPlannedToDate,
        remaining: totalPlannedToDate - totalSpentToDate,
        remainingPercentage:
          (totalPlannedToDate - totalSpentToDate) / totalPlannedToDate,
      },
      {
        name: t("full-year"),
        spent: totalSpent,
        budgeted: totalPlanned,
        remaining: totalPlanned - totalSpent,
        remainingPercentage: (totalPlanned - totalSpent) / totalPlanned,
      },
    ];
  }, [
    isTotalsDataReady,
    totalPlannedToDate,
    totalSpentToDate,
    t,
    totalSpent,
    totalPlanned,
  ]);

  if (!isTotalsDataReady || totalYearlySavings === undefined) {
    return null;
  }

  return (
    <>
      <div className="my-4">
        <Stats
          stats={[
            {
              name: t("total-income-planned"),
              value: yearlyTotalIncome,
              formatOptions: {
                style: "currency",
                currency: budgetCategoriesData.budget.currencyCode,
                maximumFractionDigits: 2,
              },
            },
            {
              name: t("total-expenses-planned"),
              value: totalPlanned,
              formatOptions: {
                style: "currency",
                currency: budgetCategoriesData.budget.currencyCode,
                maximumFractionDigits: 2,
              },
            },
            {
              name: t("yearly-result-planned"),
              value: totalYearlySavings,
              formatOptions: {
                style: "currency",
                currency: budgetCategoriesData.budget.currencyCode,
                maximumFractionDigits: 2,
              },
            },
          ]}
        />
      </div>
      <div className="flex flex-col gap-4">
        <div className="bg-background flex min-h-96 flex-col justify-center">
          <BudgetTable
            budget={data ?? []}
            budgetKey={budgetKey}
            year={new Date().getFullYear()}
            month={new Date().getMonth() + 1}
            view="year"
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
            noActions
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
      </div>
    </>
  );
}
