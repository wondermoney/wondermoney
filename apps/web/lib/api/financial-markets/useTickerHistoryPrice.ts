import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface HistoricalPrice {
  date: string; // yyyy-mm-dd
  close: number;
  // Carried through for the statistics derived from the series (52-week range,
  // average volume). The provider leaves any of them null on thin sessions, so
  // consumers must treat them as optional rather than assume a close-shaped row.
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface HistoricalPriceResponse {
  companyHistoricalPrice: {
    symbol: string;
    data: HistoricalPrice[];
  };
}

// Strict history DTO the API now returns (RAD-228): a flat { prices, symbol }
// envelope rather than the old nested { companyHistoricalPrice: { data } }.
// Points with a null close can't be plotted, so they're dropped.
interface HistoricalPriceDto {
  prices: {
    date: string;
    close: number | null;
    high?: number | null;
    low?: number | null;
    volume?: number | null;
  }[];
  symbol: string;
}

export async function getTickerHistoryPrice(
  ticker: string,
  from?: string,
  to?: string,
  includeDividends = true,
  apiClient: AxiosInstance = api,
): Promise<HistoricalPriceResponse> {
  const { data } = await apiClient.get<HistoricalPriceDto>(
    `/v1/financial-markets/ticker/${ticker}/historical-price`,
    {
      params: {
        from,
        to,
        includeDividends,
      },
    },
  );
  return {
    companyHistoricalPrice: {
      symbol: data.symbol,
      data: data.prices
        .filter((point): point is typeof point & { close: number } => point.close != null)
        .map((point) => ({
          date: point.date,
          close: point.close,
          high: point.high ?? null,
          low: point.low ?? null,
          volume: point.volume ?? null,
        })),
    },
  };
}

export default function useTickerHistoryPrice<R = HistoricalPriceResponse>(
  ticker: string,
  from?: string,
  to?: string,
  includeDividends?: boolean,
  options?: Omit<
    UseQueryOptions<HistoricalPriceResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    // `from`/`to`/`includeDividends` MUST be part of the key — otherwise
    // changing the chart timeframe (which only changes `from`) reuses the
    // cached result and never refetches, so 1y/All silently show YTD data
    // (RAD-362).
    queryKey: ["ticker-historical-price", ticker, from, to, includeDividends],
    queryFn: () => getTickerHistoryPrice(ticker, from, to, includeDividends),
    ...options,
  });
}
