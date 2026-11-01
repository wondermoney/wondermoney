import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface TickerFinancials {
  calendarYear: string;
  revenue: number;
  netIncome: number;
}

export interface TickerFinancialsResponse {
  companyFinancials: TickerFinancials[];
}

// The API's strict financials DTO: a { financials } list keyed by `period`.
interface FinancialsDto {
  financials: {
    period: string | null;
    revenue: number | null;
    netIncome: number | null;
  }[];
}

async function getTickerFinancials(
  ticker: string,
  apiClient: AxiosInstance = api,
): Promise<TickerFinancialsResponse> {
  const { data } = await apiClient.get<FinancialsDto>(
    `/v1/financial-markets/ticker/${ticker}/financials`,
  );
  return {
    companyFinancials: data.financials.map((entry) => ({
      calendarYear: entry.period ?? "",
      revenue: entry.revenue ?? 0,
      netIncome: entry.netIncome ?? 0,
    })),
  };
}

export default function useTickerFinancials<R = TickerFinancialsResponse>(
  ticker: string,
  options?: Omit<
    UseQueryOptions<TickerFinancialsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["ticker-financials", ticker],
    queryFn: () => getTickerFinancials(ticker),
    ...options,
  });
}
