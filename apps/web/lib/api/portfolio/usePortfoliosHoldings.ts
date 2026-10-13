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
  financialAssetLogoUrl?: string;
  financialAssetEsgScore?: number;
  quantity: number;
  averageBuyPrice: number;
  allocation: number | null;
  currency: string;
  unrealizedGains: number | null;
  unrealizedGainsPercentage: number | null;
  isInvalid?: boolean;
  invalidReason?: string | null;
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

export interface GetPortfoliosHoldingsResponse {
  holdings: PortfolioHolding[];
}

export async function getPortfoliosHoldings(
  apiClient: AxiosInstance = api,
): Promise<GetPortfoliosHoldingsResponse> {
  const { data } = await apiClient.get<GetPortfoliosHoldingsResponse>(
    `/v1/portfolio/holdings`,
  );
  return data;
}

export default function usePortfoliosHoldings<
  R = GetPortfoliosHoldingsResponse,
>(
  options?: Omit<
    UseQueryOptions<GetPortfoliosHoldingsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolios-holdings"],
    queryFn: () => getPortfoliosHoldings(),
    ...options,
  });
}
