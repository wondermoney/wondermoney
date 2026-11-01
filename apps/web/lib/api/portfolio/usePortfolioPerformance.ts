import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { Period } from "./usePortfolioDashboard";
export type PortfolioPerformanceReadinessStatus =
  | "empty"
  | "insufficient_history"
  | "ready";

export type PortfolioBenchmarkReadinessStatus =
  | "waiting_for_portfolio_history"
  | "missing_benchmark_data"
  | "ready";

export interface PortfolioPerformanceReadiness {
  note?: string | null;
  status: PortfolioPerformanceReadinessStatus;
}

export interface PortfolioBenchmarkReadiness {
  note?: string | null;
  status: PortfolioBenchmarkReadinessStatus;
}

export interface PerformanceDataPoint {
  date: string;
  value: number;
}

export interface PerformanceResponse {
  benchmarkDataPoints?: PerformanceDataPoint[];
  benchmarkStatus?: PortfolioBenchmarkReadinessStatus;
  benchmarkSymbol?: string;
  readiness?: {
    benchmark?: PortfolioBenchmarkReadiness;
    performance?: PortfolioPerformanceReadiness;
  };
  dataPoints: PerformanceDataPoint[];
  minDataPointsForComparison: number;
  normalizedBenchmarkDataPoints?: PerformanceDataPoint[];
  normalizedDataPoints?: PerformanceDataPoint[];
  period: string;
  portfolioHistoryStatus?: PortfolioPerformanceReadinessStatus;
}

/**
 * Fetches performance chart data
 * Uses path param for individual portfolio, aggregate endpoint for all
 */
async function getPortfolioPerformance(
  portfolioId: number | null,
  period: Period = "YTD",
  apiClient: AxiosInstance = api,
): Promise<PerformanceResponse> {
  const url = portfolioId
    ? `/v1/portfolio/${portfolioId}/performance`
    : `/v1/portfolio/performance`;
  const { data } = await apiClient.get<PerformanceResponse>(url, {
    params: { period },
  });
  return data;
}

export default function usePortfolioPerformance<R = PerformanceResponse>(
  portfolioId: number | null = null,
  period: Period = "YTD",
  options?: Omit<
    UseQueryOptions<PerformanceResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-performance", portfolioId, period],
    queryFn: () => getPortfolioPerformance(portfolioId, period),
    ...options,
  });
}
