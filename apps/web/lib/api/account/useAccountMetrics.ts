import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

export interface AccountMetrics {
  type: "inflow" | "outflow";
  accountKey: number;
  accountName: string;
  currencyCode: SupportedCurrencyCodes;
  transactionType: string;
  inflowCurrentPeriod: number;
  outflowCurrentPeriod: number;
  transactionCountCurrentPeriod: number;
  inflowPastPeriod: number;
  outflowPastPeriod: number;
  transactionCountPastPeriod: number;
  inflowDelta: number;
  inflowDeltaPercentage: number;
  outflowDelta: number;
  outflowDeltaPercentage: number;
  transactionCountDelta: number;
  transactionCountDeltaPercentage: number;
}

export type GetAccountMetricsResponse = {
  metrics: AccountMetrics[];
};

export async function getAccountMetrics(
  accountId: string | number,
  apiClient: AxiosInstance = api,
): Promise<GetAccountMetricsResponse> {
  const { data } = await apiClient.get<GetAccountMetricsResponse>(
    `/v1/account/${accountId}/metrics`,
  );
  return data;
}

export default function useAccountsMetrics<R = GetAccountMetricsResponse>(
  accountId: string | number,
  options?: Omit<
    UseQueryOptions<GetAccountMetricsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["account-metrics", accountId],
    queryFn: () => getAccountMetrics(accountId),
    ...options,
  });
}
