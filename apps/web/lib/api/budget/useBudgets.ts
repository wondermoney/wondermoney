import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface Budget {
  budgetKey: number;
  name: string;
  description?: string;
}

export interface GetBudgetsResponse {
  budgets: Budget[];
}

export async function getBudgets(
  apiClient: AxiosInstance = api,
): Promise<GetBudgetsResponse> {
  const { data } = await apiClient.get<GetBudgetsResponse>("/v1/budget");
  return data;
}

export default function useBudgets<R = GetBudgetsResponse>(
  options?: Omit<
    UseQueryOptions<GetBudgetsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["budgets"],
    queryFn: () => getBudgets(),
    ...options,
  });
}
