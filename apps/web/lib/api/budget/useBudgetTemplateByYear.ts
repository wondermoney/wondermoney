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
