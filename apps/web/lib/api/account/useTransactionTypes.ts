import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface TransactionType {
  transactionTypeKey: number;
  name: string;
}

export interface GetTransactionTypesResponse {
  transactionTypes: TransactionType[];
}

export async function getTransactionTypes(
  apiClient: AxiosInstance = api,
): Promise<GetTransactionTypesResponse> {
  const { data } = await apiClient.get<GetTransactionTypesResponse>(
    "/v1/account/transaction-types",
  );
  return data;
}

export default function useTransactionTypes<R = GetTransactionTypesResponse>(
  options?: Omit<
    UseQueryOptions<GetTransactionTypesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["transaction-types"],
    queryFn: () => getTransactionTypes(),
    ...options,
  });
}
