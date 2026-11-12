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

/** A point of the value series (`dataPoints`). */
export interface PerformanceValueDataPoint extends PerformanceDataPoint {
  /**
   * Buys minus sales that day, in the viewer's currency: positive is money put
   * in, negative money taken out, null a trade with no amount in that
   * currency. Present only on days with a trade.
   */
  netContribution?: number | null;
}

/**
 * Whether every portfolio's history could be converted into the viewer's
 * currency. A day with no exchange rate for a portfolio leaves it out and is
 * listed in `incompleteDates`. Absent from older APIs.
 */
export interface PerformanceCompleteness {
  currencyCode: string;
  incompleteDates: string[];
  isComplete: boolean;
}

export interface PerformanceResponse {
  benchmarkDataPoints?: PerformanceDataPoint[];
  benchmarkStatus?: PortfolioBenchmarkReadinessStatus;
  benchmarkSymbol?: string;
  completeness?: PerformanceCompleteness;
  readiness?: {
    benchmark?: PortfolioBenchmarkReadiness;
    performance?: PortfolioPerformanceReadiness;
  };
  dataPoints: PerformanceValueDataPoint[];
  minDataPointsForComparison: number;
  /** Benchmark price, % since the portfolio's first day: no flows, so the same basis. */
  normalizedBenchmarkDataPoints?: PerformanceDataPoint[];
  /**
   * Cumulative time-weighted return, % since the first day: a deposit or
   * withdrawal with flat prices leaves it flat. A day that could not be
   * measured (no snapshot) has no point, so its dates are a subset of
   * `dataPoints`'.
   */
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
