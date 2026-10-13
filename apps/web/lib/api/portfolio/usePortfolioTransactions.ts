import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";
import { endOfDay, startOfDay } from "date-fns";

import api from "../api";
import type { PortfolioTransaction } from "./portfolioTransactionTypes";

export interface GetPortfolioTransactionsResponse {
  transactions: PortfolioTransaction[];
}

export interface GetPortfolioTransactionsRequest {
  portfolioId: string;
  fromDate?: Date;
  limit?: number;
  toDate?: Date;
}

export async function getPortfolioTransactions(
  params: GetPortfolioTransactionsRequest,
  apiClient: AxiosInstance = api,
): Promise<GetPortfolioTransactionsResponse> {
  const { portfolioId, ...rest } = params;
  const _params = {
    ...rest,
    ...(rest.fromDate && { fromDate: startOfDay(rest.fromDate).toISOString() }),
    ...(rest.limit && { limit: rest.limit }),
    ...(rest.toDate && { toDate: endOfDay(rest.toDate).toISOString() }),
  };
  const { data } = await apiClient.get<GetPortfolioTransactionsResponse>(
    `/v1/portfolio/${portfolioId}/transactions`,
    { params: _params },
  );
  return data;
}

export default function usePortfolioTransactions<
  R = GetPortfolioTransactionsResponse,
>(
  params: GetPortfolioTransactionsRequest,
  options?: Omit<
    UseQueryOptions<GetPortfolioTransactionsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-transactions", params],
    queryFn: () => getPortfolioTransactions(params),
    ...options,
  });
}
