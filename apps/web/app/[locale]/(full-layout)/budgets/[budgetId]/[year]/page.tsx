import { notFound } from "next/navigation";

import { getServerApi } from "@/lib/api/api-server";
import { getBudgetTemplateByYear } from "@/lib/api/budget/useBudgetTemplateByYear";
import { getBudgetTemplateByYearUntilMonth } from "@/lib/api/budget/useBudgetTemplateByYearUntilMonth";

import BudgetYearClient from "./budget-year-client";

interface PageProps {
  params: Promise<{
    locale: string;
    budgetId: string;
    year: string;
  }>;
}

export default async function BudgetYearPage({ params }: PageProps) {
  const { locale, budgetId, year } = await params;

  const budgetKey = Number(budgetId);
  const yearNum = Number(year);

  if (!budgetKey || !yearNum) {
    notFound();
  }

  const api = await getServerApi(locale);
  const currentMonth = new Date().getMonth() + 1;

  const [budgetCategoriesData, budgetCategoriesUntilNowData] =
    await Promise.all([
      getBudgetTemplateByYear({ budgetKey, year: yearNum }, api),
      getBudgetTemplateByYearUntilMonth(
        { budgetKey, year: yearNum, currentMonth },
        api,
      ),
    ]);

  return (
    <BudgetYearClient
      budgetKey={budgetKey}
      year={yearNum}
      budgetCategoriesData={budgetCategoriesData}
      budgetCategoriesUntilNowData={budgetCategoriesUntilNowData}
    />
  );
}
