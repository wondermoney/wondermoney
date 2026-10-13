import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { TemplateBudget } from "./useBudgetTemplateByYearAndMonth";

export interface GetBudgetTemplateByYearResponse {
  budget: TemplateBudget;
}

export interface GetBudgetTemplateByYearRequest {
  budgetKey: number;
  year: number;
}

export async function getBudgetTemplateByYear(
  params: GetBudgetTemplateByYearRequest,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetTemplateByYearResponse> {
  const { data } = await apiClient.get<GetBudgetTemplateByYearResponse>(
    `/v1/budget/${params.budgetKey}/${params.year}`,
  );
  return data;
}

export default function useBudgetTemplateByYear<
  R = GetBudgetTemplateByYearResponse,
>(
  params: GetBudgetTemplateByYearRequest,
  options?: Omit<
    UseQueryOptions<GetBudgetTemplateByYearResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["budget-template-year", params.budgetKey, params.year],
    queryFn: () => getBudgetTemplateByYear(params),
    ...options,
  });
}
