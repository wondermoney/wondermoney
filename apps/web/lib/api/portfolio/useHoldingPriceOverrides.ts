import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { getPortfolioTransactionMutationInvalidationKeys } from "./portfolioInvalidation";

export type HoldingPriceSource = "manual" | "market";

/** One day's price: the market's, or the household's manual price for that day. */
export interface HoldingPricePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  price: number;
  source: HoldingPriceSource;
}

export interface HoldingPriceHistory {
  /** The security's currency, which every price is in. Null when the catalogue has none. */
  currency: string | null;
  prices: HoldingPricePoint[];
}

export interface HoldingPriceOnDay {
  currency: string | null;
  date: string;
  /** The household's manual price set for exactly this day. */
  override: { note: string | null; price: number } | null;
  /** The price in effect that day, which may come from an earlier manual price. */
  price: number | null;
  source: HoldingPriceSource | null;
}

export interface SaveHoldingPriceInput {
  currency: string;
  date: string;
  financialAssetKey: number;
  note?: string;
  price: number;
}

const historyKey = (financialAssetKey: number) => ["portfolio-holding-price-history", financialAssetKey];
const dayKey = (financialAssetKey: number, date?: string) =>
  date === undefined ? ["portfolio-holding-price", financialAssetKey] : ["portfolio-holding-price", financialAssetKey, date];

export async function getHoldingPriceHistory(financialAssetKey: number, client: AxiosInstance = api) {
  const { data } = await client.get<HoldingPriceHistory>(`/v1/portfolio/holding/${financialAssetKey}/prices`);
  return data;
}

export async function getHoldingPriceOnDay(financialAssetKey: number, date: string, client: AxiosInstance = api) {
  const { data } = await client.get<HoldingPriceOnDay>(`/v1/portfolio/holding/${financialAssetKey}/prices/${date}`);
  return data;
}

export function useHoldingPriceHistory(financialAssetKey: number, enabled = true) {
  return useQuery({
    enabled: enabled && financialAssetKey > 0,
    queryFn: () => getHoldingPriceHistory(financialAssetKey),
    queryKey: historyKey(financialAssetKey),
  });
}

export function useHoldingPriceOnDay(financialAssetKey: number, date: string, enabled = true) {
  return useQuery({
    enabled: enabled && financialAssetKey > 0 && Boolean(date),
    queryFn: () => getHoldingPriceOnDay(financialAssetKey, date),
    queryKey: dayKey(financialAssetKey, date),
  });
}

/** A manual price changes the holding's value and its portfolio history, so both refresh. */
async function invalidateAfterPriceChange(queryClient: QueryClient, financialAssetKey: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: historyKey(financialAssetKey) }),
    queryClient.invalidateQueries({ queryKey: dayKey(financialAssetKey) }),
    ...getPortfolioTransactionMutationInvalidationKeys().map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  ]);
}

export function useSaveHoldingPriceOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ date, financialAssetKey, ...body }: SaveHoldingPriceInput) => {
      const { data } = await api.put<HoldingPriceOnDay>(`/v1/portfolio/holding/${financialAssetKey}/prices/${date}`, body);
      return data;
    },
    onSuccess: (_data, input) => invalidateAfterPriceChange(queryClient, input.financialAssetKey),
  });
}

export function useDeleteHoldingPriceOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ date, financialAssetKey }: { date: string; financialAssetKey: number }) => {
      await api.delete(`/v1/portfolio/holding/${financialAssetKey}/prices/${date}`);
    },
    onSuccess: (_data, input) => invalidateAfterPriceChange(queryClient, input.financialAssetKey),
  });
}
