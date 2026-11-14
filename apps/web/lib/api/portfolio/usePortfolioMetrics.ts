import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import {
  portfolioMembersKey,
  portfolioMembersParams,
} from "./portfolioMembers";
export interface PortfolioMetricsReadinessEntry<
  TStatus extends string = string,
> {
  note?: string | null;
  status: TStatus;
}

export interface PortfolioMetricsReadiness {
  allocation?: PortfolioMetricsReadinessEntry<"ready" | "partial">;
  holdings?: PortfolioMetricsReadinessEntry<"ready" | "partial">;
  performance?: PortfolioMetricsReadinessEntry<
    "empty" | "insufficient_history" | "ready"
  >;
  riskMetrics?: PortfolioMetricsReadinessEntry<
    "insufficient_history" | "ready"
  >;
  note?: string | null;
}

export interface PortfolioMetrics {
  currentValue: number | null;
  assetAllocation: Record<string, number>;
  totalReturn: number | null;
  annualYield: number | null;
  volatility: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  riskLevel: "Low" | "Medium" | "High" | null;
  readiness?: PortfolioMetricsReadiness;
}

export interface PortfolioMetricsResponse {
  metrics: PortfolioMetrics;
  readiness?: {
    metrics?: PortfolioMetricsReadiness;
  };
}

/** Every household portfolio's metrics, or the member filter's (`portfolioMembers.ts`). */
export async function getPortfolioMetrics(
  fromDate?: string,
  apiClient: AxiosInstance = api,
  memberKeys?: readonly string[],
): Promise<PortfolioMetricsResponse> {
  const params = {
    ...(fromDate ? { fromDate } : {}),
    ...portfolioMembersParams(memberKeys),
  };
  const { data } = await apiClient.get<PortfolioMetricsResponse>(
    "/v1/portfolio/metrics",
    { params: Object.keys(params).length > 0 ? params : undefined },
  );
  return data;
}

export default function usePortfolioMetrics<R = PortfolioMetricsResponse>(
  fromDate?: string,
  options?: Omit<
    UseQueryOptions<PortfolioMetricsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
  memberKeys?: readonly string[],
) {
  return useQuery({
    queryKey: [
      "portfolio-metrics",
      fromDate,
      ...portfolioMembersKey(memberKeys),
    ],
    queryFn: () => getPortfolioMetrics(fromDate, api, memberKeys),
    ...options,
  });
}
