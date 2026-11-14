import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { reportsKeys } from "./keys";
import type {
  MonthComparisonData,
  MonthComparisonMonths,
  ReportFilters,
  ReportFormat,
  ReportResponse,
} from "./types";

export interface GetMonthComparisonRequest
  extends ReportFilters,
    MonthComparisonMonths {
  /** Response format. `csv` downloads a Blob (`responseType: "blob"`). */
  format?: ReportFormat;
}

/**
 * Fetches the month-vs-month comparison: both months' totals and the
 * per-category deltas.
 *
 * `base` and `compare` are `YYYY-MM` keys; they replace the date range, so
 * `fromDate`/`toDate` are not sent.
 *
 * @param params - The two months plus the shared report filters
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getMonthComparison(
  params: GetMonthComparisonRequest & { format: "csv" },
  apiClient?: AxiosInstance,
): Promise<Blob>;
export async function getMonthComparison(
  params: GetMonthComparisonRequest,
  apiClient?: AxiosInstance,
): Promise<ReportResponse<MonthComparisonData>>;
export async function getMonthComparison(
  params: GetMonthComparisonRequest,
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<MonthComparisonData> | Blob> {
  const { format, fromDate: _fromDate, toDate: _toDate, ...rest } = params;
  const isCsv = format === "csv";
  const { data } = await apiClient.get<
    ReportResponse<MonthComparisonData> | Blob
  >(
    isCsv
      ? "/v1/reports/month-comparison.csv"
      : "/v1/reports/month-comparison",
    {
      // `indexes: null` repeats array keys (accountKeys=a&accountKeys=b) so
      // they survive Express's default query parser on the API.
      params: rest,
      paramsSerializer: { indexes: null },
      responseType: isCsv ? "blob" : "json",
    },
  );
  return data;
}

export default function useMonthComparison<
  R = ReportResponse<MonthComparisonData>,
>(
  params: ReportFilters & MonthComparisonMonths,
  options?: Omit<
    UseQueryOptions<ReportResponse<MonthComparisonData>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.monthComparison(params),
    queryFn: () => getMonthComparison(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
