import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

// The API now returns a strict, flat quote DTO (RAD-228). We surface only the
// fields the watchlist renders.
//
// The numeric fields stay nullable all the way to the UI. They used to be
// coerced with `?? 0` so the row's `.toFixed()` and comparisons stayed total,
// but the market-data source we run on carries no live quote (RAD-449), so
// every watchlist row rendered "US$0.00 / +0.00%" — a quote of zero, which is
// a measurement, rather than the absence of one. Same defect class already
// fixed in `useTickerInfo`; DESIGN_HISTORY.md rule 3 makes it a standing rule
// ("any `?? 0` on a value destined for display is a bug").
export interface TickerQuoteResponse {
  symbol: string;
  name: string | null;
  price: number | null;
  changePercentage: number | null;
}

// The raw stable-DTO shape the API returns for this endpoint.
interface QuoteDto {
  symbol: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
}

export async function getTickerQuote(
  ticker: string,
  apiClient: AxiosInstance = api,
): Promise<TickerQuoteResponse> {
  const { data } = await apiClient.get<QuoteDto>(
    `/v1/financial-markets/ticker/${ticker}/quote`,
  );
  return {
    symbol: data.symbol,
    name: data.name,
    price: data.price,
    changePercentage: data.changePercent,
  };
}

export default function useTickerQuote<R = TickerQuoteResponse>(
  ticker: string,
  options?: Omit<
    UseQueryOptions<TickerQuoteResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["ticker-quote", ticker],
    queryFn: () => getTickerQuote(ticker),
    ...options,
  });
}
