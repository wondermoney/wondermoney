import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import api from "../api";

export interface Portfolio {
  appuserCurrencyCode: SupportedCurrencyCodes;
  name: string;
  balance: number;
  currencyKey: { code: SupportedCurrencyCodes };
  portfolioKey: number;
}

export interface GetPortfoliosResponse {
  portfolios: Portfolio[];
}

/**
 * Fetches all portfolios from the API.
 * Can be used in both Server Components and Client Components.
 *
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getPortfolios(
  apiClient: AxiosInstance = api,
): Promise<GetPortfoliosResponse> {
  const { data } = await apiClient.get<GetPortfoliosResponse>(`/v1/portfolio`);
  return data;
}

export default function usePortfolios<R = GetPortfoliosResponse>(
  options?: Omit<
    UseQueryOptions<GetPortfoliosResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["portfolios"],
    queryFn: () => getPortfolios(),
    ...options,
  });
}
