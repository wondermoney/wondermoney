import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface TickerEarnings {
  date: string; // YYYY-MM-DD
  symbol: string;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
  lastUpdated: string;
}

export interface TickerEarningsResponse {
  companyEarnings: TickerEarnings[];
}

// The API's strict earnings DTO: an { earnings } list with `eps`/`revenue`.
// `date` can be null on scheduled-but-undated rows — those are dropped since the
// chart keys on a real quarter date.
interface EarningsDto {
  earnings: {
    date: string | null;
    eps: number | null;
    epsEstimated: number | null;
    revenue: number | null;
    revenueEstimated: number | null;
  }[];
  symbol: string;
}

async function getTickerEarnings(
  ticker: string,
  apiClient: AxiosInstance = api,
): Promise<TickerEarningsResponse> {
  const { data } = await apiClient.get<EarningsDto>(
    `/v1/financial-markets/ticker/${ticker}/earnings`,
  );
  return {
    companyEarnings: data.earnings
      .filter((entry): entry is typeof entry & { date: string } => entry.date != null)
      .map((entry) => ({
        date: entry.date,
        symbol: data.symbol,
        epsActual: entry.eps,
        epsEstimated: entry.epsEstimated,
        revenueActual: entry.revenue,
        revenueEstimated: entry.revenueEstimated,
        lastUpdated: "",
      })),
  };
}

export default function useTickerEarnings<R = TickerEarningsResponse>(
  ticker: string,
  options?: Omit<
    UseQueryOptions<TickerEarningsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["ticker-earnings", ticker],
    queryFn: () => getTickerEarnings(ticker),
    ...options,
  });
}
