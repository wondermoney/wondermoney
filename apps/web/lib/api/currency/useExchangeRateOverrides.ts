import {
  type QueryClient,
  useMutation,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

/**
 * One of the household's own exchange rates, as `/v1/currency/rates` returns it.
 *
 * It converts `fromCurrency` into `toCurrency` (one unit of `fromCurrency` is
 * `rate` units of `toCurrency`) from `date` until the rate feed, or a later
 * override, has a newer rate. Both members of a household see and edit the same
 * list; one override per pair and day (409 `exchange_rate_override_exists`).
 */
export interface ExchangeRateOverride {
  id: number;
  fromCurrency: string;
  toCurrency: string;
  /** `YYYY-MM-DD`. */
  date: string;
  rate: number;
  updatedAt: string;
}

export interface GetExchangeRateOverridesResponse {
  /** The member's own currency: what their amounts convert to. */
  currency: string;
  overrides: ExchangeRateOverride[];
}

export const exchangeRateOverridesKey = ["exchange-rate-overrides"] as const;

export async function getExchangeRateOverrides(
  apiClient: AxiosInstance = api,
): Promise<GetExchangeRateOverridesResponse> {
  const { data } =
    await apiClient.get<GetExchangeRateOverridesResponse>("/v1/currency/rates");
  return data;
}

export default function useExchangeRateOverrides<
  R = GetExchangeRateOverridesResponse,
>(
  options?: Omit<
    UseQueryOptions<GetExchangeRateOverridesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: exchangeRateOverridesKey,
    queryFn: () => getExchangeRateOverrides(),
    ...options,
  });
}

/**
 * After an override changes, every converted figure may move: totals computed
 * on read use the new rate at once, and stored amounts follow when the
 * re-conversion job has run. Refresh the list and the money views.
 */
export const invalidateExchangeRateOverrides = async (qc: QueryClient) => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: exchangeRateOverridesKey }),
    qc.invalidateQueries({ queryKey: ["accounts"] }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions"] }),
    qc.invalidateQueries({ queryKey: ["accounts-transactions-infinite"] }),
    qc.invalidateQueries({ queryKey: ["account-transactions"] }),
    qc.invalidateQueries({ queryKey: ["net-worth"] }),
    qc.invalidateQueries({ queryKey: ["net-worth-history"] }),
    qc.invalidateQueries({ queryKey: ["reports"] }),
  ]);
};

export interface CreateExchangeRateOverrideRequest {
  fromCurrency: string;
  toCurrency: string;
  date: string;
  rate: number;
}

export function useCreateExchangeRateOverride() {
  return useMutation({
    mutationFn: async (request: CreateExchangeRateOverrideRequest) => {
      const { data } = await api.post<{ override: ExchangeRateOverride }>(
        "/v1/currency/rates",
        request,
      );
      return data.override;
    },
  });
}

export interface EditExchangeRateOverrideRequest {
  id: number;
  date?: string;
  rate?: number;
}

export function useEditExchangeRateOverride() {
  return useMutation({
    mutationFn: async ({ id, ...changes }: EditExchangeRateOverrideRequest) => {
      const { data } = await api.patch<{ override: ExchangeRateOverride }>(
        `/v1/currency/rates/${id}`,
        changes,
      );
      return data.override;
    },
  });
}

export function useDeleteExchangeRateOverride() {
  return useMutation({
    mutationFn: (id: number) => api.delete(`/v1/currency/rates/${id}`),
  });
}
