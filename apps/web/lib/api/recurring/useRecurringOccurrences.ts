import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";

export type RecurringOccurrenceStatus = "due" | "overdue" | "paid" | "projected";

export interface RecurringOccurrence {
  seriesKey: number;
  name: string;
  /** An ISO timestamp: UTC midnight for an expected date, the payment's instant otherwise. */
  date: string;
  expectedAmount: number | null;
  status: RecurringOccurrenceStatus;
  currency: string | null;
}

export interface GetRecurringOccurrencesResponse {
  items: RecurringOccurrence[];
}

export async function getRecurringOccurrences(
  from: string,
  to: string,
  apiClient: AxiosInstance = api,
): Promise<GetRecurringOccurrencesResponse> {
  const { data } = await apiClient.get<GetRecurringOccurrencesResponse>(
    "/v1/recurring/occurrences",
    { params: { from, to } },
  );
  return data;
}

const recurringOccurrencesQueryKey = (from: string, to: string) =>
  ["recurring-occurrences", from, to] as const;

export default function useRecurringOccurrences<R = GetRecurringOccurrencesResponse>(
  from: string,
  to: string,
  options?: Omit<
    UseQueryOptions<GetRecurringOccurrencesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: recurringOccurrencesQueryKey(from, to),
    queryFn: () => getRecurringOccurrences(from, to),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    ...options,
  });
}
