import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export interface ForecastPoint {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  balance: number;
}

export interface ForecastOccurrence {
  /** Null for a series with no account: it counts toward the household total only. */
  accountKey: number | null;
  /** A positive magnitude, as the recurring series stores it. */
  amount: number;
  currency: string;
  date: string;
  name: string;
  seriesKey: number;
}

export interface ForecastSeries {
  complete: boolean;
  currency: string;
  lowPoint: ForecastPoint | null;
  openingBalance: number | null;
  points: ForecastPoint[];
  projected: ForecastOccurrence[];
}

export interface ForecastAccountSeries extends ForecastSeries {
  accountKey: number;
}

export interface GetAccountForecastResponse {
  accounts: ForecastAccountSeries[];
  days: number;
  from: string;
  /** One series per currency, so a mixed-currency household is never summed into one figure. */
  totals: ForecastSeries[];
  total: ForecastSeries | null;
}

export interface GetAccountForecastRequest {
  accountKeys?: number[];
  /** Whole days, 30..90. */
  days?: number;
}

export async function getAccountForecast(
  params: GetAccountForecastRequest = {},
  apiClient: AxiosInstance = api,
): Promise<GetAccountForecastResponse> {
  const accountKeys = params.accountKeys?.length
    ? params.accountKeys.join(",")
    : undefined;
  const { data } = await apiClient.get<GetAccountForecastResponse>(
    "/v1/account/forecast",
    { params: { accountKeys, days: params.days ?? 30 } },
  );
  return data;
}

export const accountForecastQueryKey = (params: GetAccountForecastRequest) =>
  ["account-forecast", params.accountKeys?.join(",") ?? "all", params.days ?? 30] as const;

export default function useAccountForecast<
  R = GetAccountForecastResponse,
>(
  params: GetAccountForecastRequest = {},
  options?: Omit<
    UseQueryOptions<GetAccountForecastResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: accountForecastQueryKey(params),
    queryFn: () => getAccountForecast(params),
    staleTime: 60_000,
    ...options,
  });
}
