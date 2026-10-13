import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";
import type {
  BudgetCategory,
  BudgetIncome,
} from "./useBudgetTemplateByYearAndMonth";

export interface BudgetFull {
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

export interface GetBudgetsFullResponse {
  budgets: BudgetFull[];
}

/**
 * Fetches all budgets with full details from the API.
 * Can be used in both Server Components and Client Components.
 *
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getBudgetsFull(
  apiClient: AxiosInstance = api,
): Promise<GetBudgetsFullResponse> {
  const { data } = await apiClient.get<GetBudgetsFullResponse>(`/v1/budget/full`);
  return data;
}

export default function useBudgetsFull<R = GetBudgetsFullResponse>(
  options?: Omit<
    UseQueryOptions<GetBudgetsFullResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["budgets-full"],
    queryFn: () => getBudgetsFull(),
    ...options,
  });
}
