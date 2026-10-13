import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface PriceTarget {
  targetHigh: number;
  targetLow: number;
  targetConsensus: number;
  targetMedian: number;
}

export interface AnalystRecommendation {
  analystRatingsStrongBuy: number;
  analystRatingsbuy: number;
  analystRatingsHold: number;
  analystRatingsSell: number;
  analystRatingsStrongSell: number;
}

export interface HoldingAnalystResponse {
  priceTarget: PriceTarget | null;
  recommendations: AnalystRecommendation[];
}

export async function getHoldingAnalyst(
  symbol: string,
  apiClient: AxiosInstance = api,
): Promise<HoldingAnalystResponse> {
  const { data } = await apiClient.get<HoldingAnalystResponse>(
    `/v1/portfolio/holding/${symbol}/analyst`,
  );
  return data;
}

export default function useHoldingAnalyst<R = HoldingAnalystResponse>(
  symbol: string,
  options?: Omit<
    UseQueryOptions<HoldingAnalystResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["holding-analyst", symbol],
    queryFn: () => getHoldingAnalyst(symbol),
    enabled: !!symbol,
    ...options,
  });
}
