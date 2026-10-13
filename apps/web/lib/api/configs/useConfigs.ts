import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { Currency } from "../account/useCurrencies";
import type { FinancialInstitution } from "../account/useFinancialInstitutions";
import type { TransactionType } from "../account/useTransactionTypes";
import api from "../api";
import type { Category } from "../category/useCategories";
import type { FinancialBroker } from "../portfolio/useFInancialBrokers";
import type { FinancialTransactionType } from "../portfolio/useFinancialTransactionTypes";

export interface GetConfigsResponse {
  categories: Category[];
  transactionTypes: TransactionType[];
  currencies: Currency[];
  financialInstitutions: FinancialInstitution[];
  brokers: FinancialBroker[];
  financialTransactionTypes: FinancialTransactionType[];
}

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Fetches application configuration data from the API.
 * Can be used in both Server Components and Client Components.
 *
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getConfigs(
  apiClient: AxiosInstance = api,
): Promise<GetConfigsResponse> {
  const { data } = await apiClient.get<GetConfigsResponse>("/v1/configs");
  return data;
}

export default function useConfigs<R = GetConfigsResponse>(
  options?: Omit<
    UseQueryOptions<GetConfigsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["configs"],
    queryFn: () => getConfigs(),
    refetchInterval: ONE_DAY_IN_MS,
    refetchIntervalInBackground: true,
    staleTime: ONE_DAY_IN_MS,
    gcTime: ONE_DAY_IN_MS,
    ...options,
  });
}
