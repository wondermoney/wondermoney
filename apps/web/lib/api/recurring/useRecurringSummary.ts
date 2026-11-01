import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export type RecurringSummaryBreakdown = Record<string, unknown>;

export interface RecurringSummary {
  billMaxTotal: number;
  billMinTotal: number;
  monthlyTotal: number;
  monthlyMaxTotal: number;
  monthlyMinTotal: number;
  fixedTotal: number;
  subscriptionMaxTotal: number;
  subscriptionMinTotal: number;
  variableMinTotal: number;
  variableMaxTotal: number;
  needsReviewCount: number;
  detectedIncludedCount: number;
  lastDetectedAt?: string | null;
  currencyTotals?: RecurringSummaryBreakdown;
  [key: string]: unknown;
}

export type GetRecurringSummaryResponse = RecurringSummary & {
  summary?: RecurringSummary;
};

export async function getRecurringSummary(
  apiClient: AxiosInstance = api,
): Promise<GetRecurringSummaryResponse> {
  const { data } = await apiClient.get<GetRecurringSummaryResponse>(
    "/v1/recurring/summary",
  );
  return data;
}

const recurringSummaryQueryKey = ["recurring-summary"] as const;

export default function useRecurringSummary<R = GetRecurringSummaryResponse>(
  options?: Omit<
    UseQueryOptions<GetRecurringSummaryResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: recurringSummaryQueryKey,
    queryFn: () => getRecurringSummary(),
    staleTime: 60_000,
    ...options,
  });
}
