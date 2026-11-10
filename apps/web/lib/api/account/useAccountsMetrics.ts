import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";
import { transactionDateRangeParams } from "../date-range";

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

export interface GetAccountsMetricsRequest {
  fromDate?: Date;
  toDate?: Date;
}

export type GetAccountsMetricsResponse = {
  metrics: AccountMetrics[];
};

export async function getAccountsMetrics(
  params: GetAccountsMetricsRequest,
  apiClient: AxiosInstance = api,
): Promise<GetAccountsMetricsResponse> {
  const _params = transactionDateRangeParams(params);
  const { data } = await apiClient.get<GetAccountsMetricsResponse>(
    "/v1/account/metrics",
    {
      params: _params,
    },
  );
  return data;
}

export default function useAccountsMetrics<R = GetAccountsMetricsResponse>(
  params: { fromDate?: Date; toDate?: Date },
  options?: Omit<
    UseQueryOptions<GetAccountsMetricsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["accounts-metrics", params],
    queryFn: () => getAccountsMetrics(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
