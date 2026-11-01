import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface TickerFundamentalsMetrics {
  // P/E (TTM) and EPS (TTM). `null` when the provider has no value.
  peTtm: number | null;
  epsTtm: number | null;
  // Dividend yield as a fraction (0.0078 = 0.78%), from ratios-ttm.
  dividendYieldTtm: number | null;
  // Next (upcoming) earnings date as YYYY-MM-DD, or null if none is scheduled.
  nextEarningsDate: string | null;
}

// The market-snapshot fields the fundamentals card reads (market cap, 52-week
// range, avg volume). Kept as its own slim type rather than the full quote.
export interface TickerFundamentalsQuote {
  marketCap: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  volume: number | null;
}

export interface TickerFundamentalsResponse {
  fundamentals: {
    quote: TickerFundamentalsQuote;
    metrics: TickerFundamentalsMetrics;
  };
}

// The API's flat fundamentals DTO. We reshape it into the nested
// { quote, metrics } the card consumes.
interface FundamentalsDto {
  marketCap: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  avgVolume: number | null;
  peRatio: number | null;
  earningsPerShare: number | null;
  dividendYield: number | null;
  nextEarningsDate: string | null;
}

async function getTickerFundamentals(
  ticker: string,
  apiClient: AxiosInstance = api,
): Promise<TickerFundamentalsResponse> {
  const { data } = await apiClient.get<FundamentalsDto>(
    `/v1/financial-markets/ticker/${ticker}/fundamentals`,
  );
  return {
    fundamentals: {
      quote: {
        marketCap: data.marketCap,
        yearLow: data.fiftyTwoWeekLow,
        yearHigh: data.fiftyTwoWeekHigh,
        volume: data.avgVolume,
      },
      metrics: {
        peTtm: data.peRatio,
        epsTtm: data.earningsPerShare,
        dividendYieldTtm: data.dividendYield,
        nextEarningsDate: data.nextEarningsDate,
      },
    },
  };
}

export default function useTickerFundamentals<R = TickerFundamentalsResponse>(
  ticker: string,
  options?: Omit<
    UseQueryOptions<TickerFundamentalsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["ticker-fundamentals", ticker],
    queryFn: () => getTickerFundamentals(ticker),
    ...options,
  });
}
