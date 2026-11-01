import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

interface DividendByAsset {
  financialAssetKey: number;
  symbol: string;
  totalDividends: number;
}

export interface DividendIncomeResponse {
  byAsset: DividendByAsset[];
  totalDividends: number;
}

/**
 * Fetches dividend income data
 * Uses path param for individual portfolio, aggregate endpoint for all
 */
async function getDividendIncome(
  portfolioId: number | null,
  apiClient: AxiosInstance = api,
): Promise<DividendIncomeResponse> {
  const url = portfolioId
    ? `/v1/portfolio/${portfolioId}/dividend-income`
    : `/v1/portfolio/dividend-income`;
  const { data } = await apiClient.get<DividendIncomeResponse>(url);
  return data;
}

export default function useDividendIncome<R = DividendIncomeResponse>(
  portfolioId: number | null = null,
  options?: Omit<
    UseQueryOptions<DividendIncomeResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["dividend-income", portfolioId],
    queryFn: () => getDividendIncome(portfolioId),
    ...options,
  });
}
