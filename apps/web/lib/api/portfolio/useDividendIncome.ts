import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AmountsCompleteness } from "../completeness";

interface DividendByAsset {
  financialAssetKey: number;
  symbol: string;
  totalDividends: number;
}

/** Totals in the viewer's currency (`completeness.currencyCode`). */
export interface DividendIncomeResponse {
  byAsset: DividendByAsset[];
  /** The dividends left out because no exchange rate converts them. */
  completeness?: AmountsCompleteness;
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
