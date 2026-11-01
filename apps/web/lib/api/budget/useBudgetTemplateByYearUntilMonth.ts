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
