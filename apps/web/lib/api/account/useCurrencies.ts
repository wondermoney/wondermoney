import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface Currency {
  currencyKey: number;
  code: string;
  description: string;
}

export interface GetCurrenciesResponse {
  currencies: Currency[];
}

export async function getCurrencies(
  apiClient: AxiosInstance = api,
): Promise<GetCurrenciesResponse> {
  const { data } = await apiClient.get<GetCurrenciesResponse>(
    "/v1/account/currencies",
  );
  return data;
}

export default function useCurrencies<R = GetCurrenciesResponse>(
  options?: Omit<
    UseQueryOptions<GetCurrenciesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["currencies"],
    queryFn: () => getCurrencies(),
    ...options,
  });
}
