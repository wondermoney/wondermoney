import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { PortfolioCostBasisMethod } from "./usePortfolio";

/** One purchase lot as the holding detail's lots section reads it. */
export interface PortfolioHoldingLot {
  /** Purchase date (ISO 8601). For an AVERAGE pool, the earliest open lot's date. */
  date: string;
  /** The fee recorded on the purchase. */
  fees: number;
  /** The lot's quantity at purchase, split-adjusted. */
  quantity: number;
  /** What is still open from this lot. */
  remainingQuantity: number;
  status: "CLOSED" | "OPEN";
  /** The buy that created the lot; null for the single AVERAGE pooled position. */
  transactionKey: number | null;
  /** Per-unit cost excluding fees. */
  unitCost: number;
}

export interface PortfolioHoldingLots {
  /** All-in cost per open unit (fees included), matching the holding's average buy price. */
  averageUnitCost: number | null;
  costBasisMethod: PortfolioCostBasisMethod;
  lots: PortfolioHoldingLot[];
  /** Cost basis of the open position, fees included. */
  openCostBasis: number;
  openQuantity: number;
  /** Cost relieved by sales so far, under this portfolio's method. */
  realizedCostBasis: number;
}

export async function getPortfolioHoldingLots(
  portfolioId: string,
  financialAssetKey: number,
  apiClient: AxiosInstance = api,
): Promise<PortfolioHoldingLots> {
  const { data } = await apiClient.get<PortfolioHoldingLots>(
    `/v1/portfolio/${portfolioId}/holding/${financialAssetKey}/lots`,
  );
  return data;
}

export default function usePortfolioHoldingLots(
  portfolioId: string,
  financialAssetKey: number | null | undefined,
  options?: Omit<
    UseQueryOptions<PortfolioHoldingLots, Error>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio-holding-lots", portfolioId, financialAssetKey],
    queryFn: () => getPortfolioHoldingLots(portfolioId, financialAssetKey!),
    enabled: Boolean(portfolioId) && financialAssetKey != null,
    ...options,
  });
}
