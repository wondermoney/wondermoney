import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * A household merchant (`MerchantDto` in the API). `website` and `logoUrl` are what the household
 * typed, shown in the edit form; `resolvedLogoUrl` is the one image to render, or null for the
 * initial-letter avatar. Render merchants through `components/merchant/MerchantAvatar`.
 */
export interface TransactionMerchant {
  transactionMerchantKey: number;
  name: string;
  website: string | null;
  logoUrl: string | null;
  /**
   * The household's own `logoUrl`, the API's authenticated logo proxy, or null. Loaded as a
   * plain `<img>`: the session cookie reaches the API proxy, and a third-party URL is fetched
   * with no referrer.
   */
  resolvedLogoUrl: string | null;
}

/** The query key every merchant list shares; a merchant edit invalidates it. */
export const TRANSACTION_MERCHANTS_QUERY_KEY = [
  "transaction-merchants",
] as const;

export interface GetTransactionMerchantsResponse {
  transactionMerchants: TransactionMerchant[];
}

export interface TransactionMerchantsParams {
  limit?: number;
  search?: string;
}

async function getTransactionMerchants(
  params: TransactionMerchantsParams = {},
  apiClient: AxiosInstance = api,
): Promise<GetTransactionMerchantsResponse> {
  const { data } = await apiClient.get<GetTransactionMerchantsResponse>(
    "/v1/account/transaction-merchants",
    { params },
  );
  return data;
}

export default function useTransactionMerchants<
  R = GetTransactionMerchantsResponse,
>(
  params: TransactionMerchantsParams = {},
  options?: Omit<
    UseQueryOptions<GetTransactionMerchantsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: [...TRANSACTION_MERCHANTS_QUERY_KEY, params],
    queryFn: () => getTransactionMerchants(params),
    ...options,
  });
}
