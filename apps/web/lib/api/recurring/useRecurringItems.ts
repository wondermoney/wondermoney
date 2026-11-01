import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export type RecurringType = "subscription" | "bill";
export type RecurringStatus =
  | "candidate"
  | "confirmed"
  | "dismissed"
  | "paused"
  | "ended";
export type RecurringSource = "detected" | "user_created";
export type RecurringCadence =
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "weekly"
  | "yearly";
export type RecurringAmountType = "fixed" | "variable";

export interface RecurringCategory {
  categoryKey: number;
  name: string;
  isSystemCategory?: boolean;
  bgColor?: string;
  textColor?: string;
  icon?: string;
}

export interface RecurringCurrency {
  currencyKey: number;
  code?: string;
  symbol?: string;
}

export interface RecurringItem {
  recurringSeriesKey: number;
  type: RecurringType;
  status: RecurringStatus;
  source: RecurringSource;
  confidenceScore: number;
  displayName: string;
  normalizedMerchantKey: string;
  cadence: RecurringCadence;
  cadenceConfidence: number;
  amountType: RecurringAmountType;
  expectedAmount?: number | null;
  expectedAmountMin?: number | null;
  expectedAmountMax?: number | null;
  averageAmount?: number | null;
  lastAmount?: number | null;
  nextExpectedAt?: string | null;
  lastSeenAt?: string | null;
  occurrenceCount: number;
  accountKey?: number | null;
  category?: RecurringCategory | null;
  currency?: RecurringCurrency | null;
}

export interface GetRecurringItemsResponse {
  items: RecurringItem[];
}

export async function getRecurringItems(
  apiClient: AxiosInstance = api,
): Promise<GetRecurringItemsResponse> {
  const { data } =
    await apiClient.get<GetRecurringItemsResponse>("/v1/recurring");
  return data;
}

const recurringItemsQueryKey = ["recurring-items"] as const;

export default function useRecurringItems<R = GetRecurringItemsResponse>(
  options?: Omit<
    UseQueryOptions<GetRecurringItemsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: recurringItemsQueryKey,
    queryFn: () => getRecurringItems(),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    ...options,
  });
}
