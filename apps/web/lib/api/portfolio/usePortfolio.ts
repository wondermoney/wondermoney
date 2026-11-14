import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { PortfolioAccountLink } from "@/lib/portfolio/account-link";
import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

export type PortfolioCostBasisMethod = "AVERAGE" | "FIFO";

export interface Portfolio {
  name: string;
  balance: number;
  currencyKey: { code: SupportedCurrencyCodes };
  portfolioKey: number;
  benchmarkSymbol?: string | null;
  /** How a sale relieves cost. FIFO (oldest lots first) is the default. */
  costBasisMethod?: PortfolioCostBasisMethod;
  description?: string | null;
  excluded?: boolean;
  targetAllocation?: Record<string, number> | null;
  /** The account that holds this portfolio, when the viewer can see it. */
  accountLink?: PortfolioAccountLink | null;
}

export interface GetPortfolioResponse {
  portfolio: Portfolio;
}

export async function getPortfolio(
  portfolioId: number,
  apiClient: AxiosInstance = api,
): Promise<GetPortfolioResponse> {
  const { data } = await apiClient.get<GetPortfolioResponse>(
    `/v1/portfolio/${portfolioId}`,
  );
  return data;
}

export default function usePortfolio<R = GetPortfolioResponse>(
  portfolioId: number,
  options?: Omit<
    UseQueryOptions<GetPortfolioResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolio", portfolioId],
    queryFn: () => getPortfolio(portfolioId),
    ...options,
  });
}
