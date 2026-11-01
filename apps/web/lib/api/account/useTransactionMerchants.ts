import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface TransactionMerchant {
  transactionMerchantKey: number;
  name: string;
}

export interface GetTransactionMerchantsResponse {
  transactionMerchants: TransactionMerchant[];
}

export interface TransactionMerchantsParams {
  limit?: number;
  search?: string;
}

async function getTransactionMerchants(
  params: TransactionMerchantsParams = {},
  apiClient: AxiosInstance = api,
): Promise<GetTransactionMerchantsResponse> {
  const { data } = await apiClient.get<GetTransactionMerchantsResponse>(
    "/v1/account/transaction-merchants",
    { params },
  );
  return data;
}

export default function useTransactionMerchants<
  R = GetTransactionMerchantsResponse,
>(
  params: TransactionMerchantsParams = {},
  options?: Omit<
    UseQueryOptions<GetTransactionMerchantsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["transaction-merchants", params],
    queryFn: () => getTransactionMerchants(params),
    ...options,
  });
}
