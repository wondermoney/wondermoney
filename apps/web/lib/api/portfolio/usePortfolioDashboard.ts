import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

// The API adds opt-in summary fields only when asked, so strict older clients keep parsing.
const DASHBOARD_INCLUDE = "feeConversion";

export type Period = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

export interface DashboardSummary {
  totalValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  periodReturn: number | null;
  periodLabel: string;
  assetCount: number;
  portfolioCount?: number;
  currency: SupportedCurrencyCodes;
  lastUpdated: string;
  unrealizedGains: number;
  realizedGains: number;
  /**
   * Assets with a trade fee the API could not convert to the user's currency
   * (counted as zero). Sent only when requested with `include=feeConversion`
   * and non-empty; covers fully sold assets, which have no holding to flag.
   */
  feeConversionIncompleteAssetKeys?: number[];
}

export interface PortfolioBreakdownItem {
  portfolioKey: number;
  name: string;
  value: number;
  weight: number;
  gainPercent: number;
  currency: string;
}

export interface QuickStats {
  holdingsCount: number | null;
  biggestPosition: { ticker: string | null; weight: number | null } | null;
  bestPerformer: { ticker: string | null; change: number | null } | null;
  worstPerformer: { ticker: string | null; change: number | null } | null;
}

export interface AggregateDashboardResponse {
  summary: DashboardSummary;
  portfolios: PortfolioBreakdownItem[];
}

export interface IndividualDashboardResponse {
  summary: Omit<DashboardSummary, "portfolioCount">;
  quickStats: QuickStats;
}

/**
 * Fetches aggregate dashboard data for all portfolios
 */
export async function getAggregateDashboard(
  period: Period = "YTD",
  apiClient: AxiosInstance = api,
): Promise<AggregateDashboardResponse> {
  const { data } = await apiClient.get<AggregateDashboardResponse>(
    `/v1/portfolio/dashboard`,
    { params: { period, include: DASHBOARD_INCLUDE } },
  );
  return data;
}

/**
 * Fetches dashboard data for a specific portfolio
 */
export async function getPortfolioDashboard(
  portfolioId: number,
  period: Period = "YTD",
  apiClient: AxiosInstance = api,
): Promise<IndividualDashboardResponse> {
  const { data } = await apiClient.get<IndividualDashboardResponse>(
    `/v1/portfolio/${portfolioId}/dashboard`,
    { params: { period, include: DASHBOARD_INCLUDE } },
  );
  return data;
}

export function useAggregateDashboard<R = AggregateDashboardResponse>(
  period: Period = "YTD",
  options?: Omit<
    UseQueryOptions<AggregateDashboardResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-dashboard", "aggregate", period],
    queryFn: () => getAggregateDashboard(period),
    ...options,
  });
}

export function usePortfolioDashboard<R = IndividualDashboardResponse>(
  portfolioId: number,
  period: Period = "YTD",
  options?: Omit<
    UseQueryOptions<IndividualDashboardResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-dashboard", portfolioId, period],
    queryFn: () => getPortfolioDashboard(portfolioId, period),
    enabled: !!portfolioId,
    ...options,
  });
}
