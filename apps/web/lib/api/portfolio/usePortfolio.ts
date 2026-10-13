import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

export interface Portfolio {
  name: string;
  balance: number;
  currencyKey: { code: SupportedCurrencyCodes };
  portfolioKey: number;
  benchmarkSymbol?: string;
  description?: string | null;
  excluded?: boolean;
  favored?: boolean;
  targetAllocation?: Record<string, number> | null;
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
