import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface AllocationItem {
  type: string;
  value: number;
  percentage: number;
}

export interface AssetClassDrift {
  assetClass: string;
  currentPct: number;
  targetPct: number;
  driftPts: number;
}

export interface UnclassifiedHolding {
  name: string;
  value: number;
}

export interface AllocationResponse {
  byType: AllocationItem[];
  bySector?: AllocationItem[];
  byAsset?: AllocationItem[];
  byAssetClass: AllocationItem[];
  unclassifiedHoldings: UnclassifiedHolding[];
  driftRows?: AssetClassDrift[];
  guidanceText?: string | null;
}

/**
 * Fetches allocation breakdown data
 * Uses path param for individual portfolio, aggregate endpoint for all
 */
export async function getPortfolioAllocation(
  portfolioId: number | null,
  apiClient: AxiosInstance = api,
): Promise<AllocationResponse> {
  const url = portfolioId
    ? `/v1/portfolio/${portfolioId}/allocation`
    : `/v1/portfolio/allocation`;
  const { data } = await apiClient.get<AllocationResponse>(url);
  return data;
}

export default function usePortfolioAllocation<R = AllocationResponse>(
  portfolioId: number | null = null,
  options?: Omit<
    UseQueryOptions<AllocationResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-allocation", portfolioId],
    queryFn: () => getPortfolioAllocation(portfolioId),
    ...options,
  });
}
