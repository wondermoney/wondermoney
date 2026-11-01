import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { Period } from "./usePortfolioDashboard";

export interface TopMover {
  ticker: string;
  name: string;
  change: number;
  contribution: number;
  logoUrl?: string;
}

export interface TopMoversResponse {
  period: string;
  gainers: TopMover[];
  losers: TopMover[];
}

/**
 * Fetches top movers (gainers and losers)
 * Uses path param for individual portfolio, aggregate endpoint for all
 */
async function getPortfolioTopMovers(
  portfolioId: number | null,
  period: Period = "YTD",
  limit: number = 5,
  apiClient: AxiosInstance = api,
): Promise<TopMoversResponse> {
  const url = portfolioId
    ? `/v1/portfolio/${portfolioId}/top-movers`
    : `/v1/portfolio/top-movers`;
  const { data } = await apiClient.get<TopMoversResponse>(url, {
    params: { period, limit },
  });
  return data;
}

export default function usePortfolioTopMovers<R = TopMoversResponse>(
  portfolioId: number | null = null,
  period: Period = "YTD",
  limit: number = 5,
  options?: Omit<
    UseQueryOptions<TopMoversResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-top-movers", portfolioId, period, limit],
    queryFn: () => getPortfolioTopMovers(portfolioId, period, limit),
    ...options,
  });
}
