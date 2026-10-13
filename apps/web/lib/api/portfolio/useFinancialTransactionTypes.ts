import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface FinancialTransactionType {
  financialTransactionTypeKey: string;
  name: string;
}

export interface GetFinancialTransactionTypesResponse {
  transactionTypes: FinancialTransactionType[];
}

export async function getFinancialTransactionTypes(
  apiClient: AxiosInstance = api,
): Promise<GetFinancialTransactionTypesResponse> {
  const { data } = await apiClient.get<GetFinancialTransactionTypesResponse>(
    `/v1/portfolio/transaction-types`,
  );
  return data;
}

export default function useFinancialTransactionTypes<
  R = GetFinancialTransactionTypesResponse,
>(
  options?: Omit<
    UseQueryOptions<GetFinancialTransactionTypesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["financial-transaction-types"],
    queryFn: () => getFinancialTransactionTypes(),
    ...options,
  });
}
