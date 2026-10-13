import { notFound } from "next/navigation";

import { getServerApi } from "@/lib/api/api-server";
import { getBudgetTemplateByYear } from "@/lib/api/budget/useBudgetTemplateByYear";
import { getBudgetTemplateByYearAndMonth } from "@/lib/api/budget/useBudgetTemplateByYearAndMonth";

import BudgetMonthClient from "./budget-month-client";

interface PageProps {
  params: Promise<{
    locale: string;
    budgetId: string;
    year: string;
    month: string;
  }>;
}

export default async function BudgetMonthPage({ params }: PageProps) {
  const { locale, budgetId, year, month } = await params;

  const budgetKey = Number(budgetId);
  const yearNum = Number(year);
  const monthNum = Number(month);

  if (!budgetKey || !yearNum || !monthNum) {
    notFound();
  }

  const api = await getServerApi(locale);

  const [budgetCategoriesData, budgetCategoriesYearlyData] = await Promise.all([
    getBudgetTemplateByYearAndMonth(
      { budgetKey, year: yearNum, month: monthNum },
      api,
    ),
    getBudgetTemplateByYear({ budgetKey, year: yearNum }, api),
  ]);

  return (
    <BudgetMonthClient
      budgetKey={budgetKey}
      year={yearNum}
      month={monthNum}
      budgetCategoriesData={budgetCategoriesData}
      budgetCategoriesYearlyData={budgetCategoriesYearlyData}
    />
  );
}
