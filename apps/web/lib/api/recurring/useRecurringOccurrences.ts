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

/** A card installment scheduled inside the range: `paid` once linked, `projected` before. */
export interface InstallmentOccurrence {
  amount: number;
  currency: string;
  /** `YYYY-MM-DD`. */
  date: string;
  installmentCount: number;
  installmentNumber: number;
  installmentPlanKey: number;
  name: string;
  status: "paid" | "projected";
}

export interface GetRecurringOccurrencesResponse {
  items: RecurringOccurrence[];
  /** Optional because an older API does not send it; read it as `?? []`. */
  installments?: InstallmentOccurrence[];
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
