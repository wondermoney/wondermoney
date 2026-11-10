import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { dateRangeParams } from "../date-range";
import type { PortfolioTransaction } from "./portfolioTransactionTypes";

export interface GetPortfoliosTransactionsResponse {
  transactions: PortfolioTransaction[];
}

export interface GetPortfoliosTransactionsRequest {
  ticker?: string;
  fromDate?: Date;
  limit?: number;
  toDate?: Date;
}

export async function getPortfoliosTransactions(
  params: GetPortfoliosTransactionsRequest = {},
  apiClient: AxiosInstance = api,
): Promise<GetPortfoliosTransactionsResponse> {
  const _params = {
    ...params,
    ...(params.limit && { limit: params.limit }),
    ...dateRangeParams(params),
  };
  const { data } = await apiClient.get<GetPortfoliosTransactionsResponse>(
    `/v1/portfolio/transactions`,
    {
      params: _params,
    },
  );
  return data;
}

export default function usePortfoliosTransactions<
  R = GetPortfoliosTransactionsResponse,
>(
  params?: GetPortfoliosTransactionsRequest,
  options?: Omit<
    UseQueryOptions<GetPortfoliosTransactionsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolios-transactions", params],
    queryFn: () => getPortfoliosTransactions(params),
    ...options,
  });
}
