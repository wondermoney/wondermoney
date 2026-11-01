import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { Budget } from "./useBudgets";

export interface GetBudgetResponse {
  budget: Budget;
}

async function getBudget(
  budgetKey: number,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetResponse> {
  const { data } = await apiClient.get<GetBudgetResponse>(`/v1/budget/${budgetKey}`);
  return data;
}

export default function useBudget<R = GetBudgetResponse>(
  budgetKey: number,
  options?: Omit<
    UseQueryOptions<GetBudgetResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["budget", budgetKey],
    queryFn: () => getBudget(budgetKey),
    ...options,
  });
}
