import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface ValuationMetrics {
  peRatio: number | null;
  pbRatio: number | null;
  roe: number | null;
  dividendYield: number | null;
  evToEbitda: number | null;
  currentRatio: number | null;
}

export interface HoldingValuationResponse {
  valuation: ValuationMetrics | null;
}

async function getHoldingValuation(
  symbol: string,
  apiClient: AxiosInstance = api,
): Promise<HoldingValuationResponse> {
  const { data } = await apiClient.get<HoldingValuationResponse>(
    `/v1/portfolio/holding/${symbol}/valuation`,
  );
  return data;
}

export default function useHoldingValuation<R = HoldingValuationResponse>(
  symbol: string,
  options?: Omit<
    UseQueryOptions<HoldingValuationResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["holding-valuation", symbol],
    queryFn: () => getHoldingValuation(symbol),
    enabled: !!symbol,
    ...options,
  });
}
