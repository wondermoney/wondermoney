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
  ReportFormat,
  ReportResponse,
  SpendingByCategoryRow,
} from "./types";

export interface GetSpendingByCategoryRequest extends ReportFilters {
  /** Response format. `csv` downloads a Blob (`responseType: "blob"`). */
  format?: ReportFormat;
}

/**
 * Fetches the date-bounded category spending rollup.
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Filter envelope; pass `format: "csv"` to download a Blob
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getSpendingByCategory(
  params: GetSpendingByCategoryRequest & { format: "csv" },
  apiClient?: AxiosInstance,
): Promise<Blob>;
export async function getSpendingByCategory(
  params?: GetSpendingByCategoryRequest,
  apiClient?: AxiosInstance,
): Promise<ReportResponse<SpendingByCategoryRow[]>>;
export async function getSpendingByCategory(
  params: GetSpendingByCategoryRequest = {},
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<SpendingByCategoryRow[]> | Blob> {
  const { format, ...filters } = params;
  const isCsv = format === "csv";
  const { data } = await apiClient.get<
    ReportResponse<SpendingByCategoryRow[]> | Blob
  >(
    isCsv
      ? "/v1/reports/spending-by-category.csv"
      : "/v1/reports/spending-by-category",
    {
      // `indexes: null` repeats array keys (accountKeys=a&accountKeys=b) so
      // they survive Express's default query parser on the API.
      params: filters,
      paramsSerializer: { indexes: null },
      responseType: isCsv ? "blob" : "json",
    },
  );
  return data;
}

export default function useSpendingByCategory<
  R = ReportResponse<SpendingByCategoryRow[]>,
>(
  params: ReportFilters = {},
  options?: Omit<
    UseQueryOptions<ReportResponse<SpendingByCategoryRow[]>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.spendingByCategory(params),
    queryFn: () => getSpendingByCategory(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
