import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface PortfolioHolding {
  currentPrice: number | null;
  currentValue: number | null;
  financialAssetKey: number;
  financialAssetName: string;
  financialAssetSymbol: string;
  financialAssetType: string;
  quantity: number;
  averageBuyPrice: number;
  allocation: number | null;
  currency: string;
  unrealizedGains: number | null;
  unrealizedGainsPercentage: number | null;
  financialAssetEsgScore?: number;
  /**
   * Present only for Savings Certificate (Certificado de Aforro) holdings.
   * `currentRateBps`/`premiumTierBps` come from a single representative lot
   * (not genuinely per-lot); the `lots[]` entries themselves are per-lot.
   */
  certificadoAforroDetail?: {
    currentRateBps: number;
    premiumTierBps: number;
    nextCapitalizationDate: string;
    lots: {
      transactionKey: number;
      subscriptionDate: string;
      principal: number;
      accruedValue: number;
      taxExempt: boolean;
      yearsHeld: number;
    }[];
  };
}

export interface GetPortfolioHoldingsResponse {
  holdings: PortfolioHolding[];
}

export async function getPortfolioHoldings(
  portfolioId: string,
  apiClient: AxiosInstance = api,
): Promise<GetPortfolioHoldingsResponse> {
  const { data } = await apiClient.get<GetPortfolioHoldingsResponse>(
    `/v1/portfolio/${portfolioId}/holdings`,
  );
  return data;
}

export default function usePortfolioHoldings<R = GetPortfolioHoldingsResponse>(
  portfolioId: string,
  options?: Omit<
    UseQueryOptions<GetPortfolioHoldingsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-holdings", portfolioId],
    queryFn: () => getPortfolioHoldings(portfolioId),
    ...options,
  });
}
