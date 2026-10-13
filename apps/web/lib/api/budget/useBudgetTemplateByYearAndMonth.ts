import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

export interface BudgetCategory {
  child_category_name: string | null;
  parent_category_name: string;
  category_amount: number;
  category_recurrency: string | null;
  category_budgeted_amount: number;
  child_category_icon: string;
  child_category_text_color: string;
  child_category_bg_color: string;
  category_is_system_category: boolean;
  category_icon: string;
  category_text_color: string;
  category_bg_color: string;
  category_key: number;
}

export type BudgetIncome = {
  name: string;
  amount: number;
  recurrency: string;
};

export interface TemplateBudget {
  budgetKey: number;
  currencyCode: SupportedCurrencyCodes;
  name: string;
  description?: string;
  month: number;
  year: number;
  accounts: {
    accountKey: number;
    accountName: string;
  }[];
  categories: BudgetCategory[];
  incomes: BudgetIncome[];
}

export interface GetBudgetTemplateByYearAndMonthResponse {
  hasPreviousMonth: boolean;
  hasNextMonth: boolean;
  budget: TemplateBudget;
}

export interface GetBudgetTemplateByYearAndMonthRequest {
  budgetKey: number;
  month: number;
  year: number;
}

export async function getBudgetTemplateByYearAndMonth(
  params: GetBudgetTemplateByYearAndMonthRequest,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetTemplateByYearAndMonthResponse> {
  const { data } = await apiClient.get<GetBudgetTemplateByYearAndMonthResponse>(
    `/v1/budget/${params.budgetKey}/${params.year}/${params.month}`,
  );
  return data;
}

export default function useBudgetTemplateByYearAndMonth<
  R = GetBudgetTemplateByYearAndMonthResponse,
>(
  params: GetBudgetTemplateByYearAndMonthRequest,
  options?: Omit<
    UseQueryOptions<GetBudgetTemplateByYearAndMonthResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: [
      "budget-template-year-month",
      params.budgetKey,
      params.month,
      params.year,
    ],
    queryFn: () => getBudgetTemplateByYearAndMonth(params),
    ...options,
  });
}
