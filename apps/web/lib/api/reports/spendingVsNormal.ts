import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { reportsKeys } from "./keys";
import type {
  ReportFilters,
  ReportResponse,
  SpendingVsNormalData,
} from "./types";

export interface GetSpendingVsNormalRequest extends ReportFilters {
  /** The calendar month to read, `YYYY-MM`. It replaces the date range. */
  month: string;
}

/**
 * Fetches this month's spend per category against its three-month normal.
 *
 * `month` is a `YYYY-MM` key; the API turns it into the month's range in the
 * viewer's time zone, so the same month means the same days for the report and
 * the transaction list a tile links to.
 *
 * @param params - The month plus the shared report filters
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getSpendingVsNormal(
  params: GetSpendingVsNormalRequest,
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<SpendingVsNormalData>> {
  const { fromDate: _fromDate, toDate: _toDate, ...rest } = params;
  const { data } = await apiClient.get<ReportResponse<SpendingVsNormalData>>(
    "/v1/reports/spending-vs-normal",
    {
      // `indexes: null` repeats array keys (accountKeys=a&accountKeys=b) so
      // they survive Express's default query parser on the API.
      params: rest,
      paramsSerializer: { indexes: null },
    },
  );
  return data;
}

export default function useSpendingVsNormal<
  R = ReportResponse<SpendingVsNormalData>,
>(
  params: GetSpendingVsNormalRequest,
  options?: Omit<
    UseQueryOptions<ReportResponse<SpendingVsNormalData>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.spendingVsNormal(params),
    queryFn: () => getSpendingVsNormal(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
