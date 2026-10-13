import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface Account {
  accountKey: number;
  accountName: string;
}

export interface GetBudgetAccountsResponse {
  accounts: Account[];
}

export async function getBudgetAccounts(
  budgetKey: number,
  apiClient: AxiosInstance = api,
): Promise<GetBudgetAccountsResponse> {
  const { data } = await apiClient.get<GetBudgetAccountsResponse>(
    `/v1/budget/${budgetKey}/accounts`,
  );
  return data;
}

export default function useBudgetAccounts<R = GetBudgetAccountsResponse>(
  budgetKey: number,
  options?: Omit<
    UseQueryOptions<GetBudgetAccountsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["budget-accounts", budgetKey],
    queryFn: () => getBudgetAccounts(budgetKey),
    ...options,
  });
}
