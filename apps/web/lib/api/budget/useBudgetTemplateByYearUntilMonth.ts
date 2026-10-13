import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { TemplateBudget } from "./useBudgetTemplateByYearAndMonth";

export interface GetBudgetTemplateByYearUntilMonthResponse {
  budget: TemplateBudget;
}

export interface GetBudgetTemplateByYearUntilMonthRequest {
  budgetKey: number;
  year: number;
  currentMonth: number;
}

export async function getBudgetTemplateByYearUntilMonth(
  params: GetBudgetTemplateByYearUntilMonthRequest,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetTemplateByYearUntilMonthResponse> {
  const { data } = await apiClient.get<GetBudgetTemplateByYearUntilMonthResponse>(
    `/v1/budget/${params.budgetKey}/${params.year}/until/${params.currentMonth}`,
  );
  return data;
}

export default function useBudgetTemplateByYearUntilMonth<
  R = GetBudgetTemplateByYearUntilMonthResponse,
>(
  params: GetBudgetTemplateByYearUntilMonthRequest,
  options?: Omit<
    UseQueryOptions<GetBudgetTemplateByYearUntilMonthResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["budget-template-year-until-month", params],
    queryFn: () => getBudgetTemplateByYearUntilMonth(params),
    ...options,
  });
}
