import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { reportsKeys } from "./keys";
import type {
  BudgetVsActualRow,
  ReportFilters,
  ReportFormat,
  ReportResponse,
} from "./types";

export interface GetBudgetVsActualRequest extends ReportFilters {
  /** Response format. `csv` downloads a Blob (`responseType: "blob"`). */
  format?: ReportFormat;
}

/**
 * Fetches the per-category budget vs actual comparison for the period.
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Filter envelope; pass `format: "csv"` to download a Blob
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getBudgetVsActual(
  params: GetBudgetVsActualRequest & { format: "csv" },
  apiClient?: AxiosInstance,
): Promise<Blob>;
export async function getBudgetVsActual(
  params?: GetBudgetVsActualRequest,
  apiClient?: AxiosInstance,
): Promise<ReportResponse<BudgetVsActualRow[]>>;
export async function getBudgetVsActual(
  params: GetBudgetVsActualRequest = {},
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<BudgetVsActualRow[]> | Blob> {
  const { format, ...filters } = params;
  const isCsv = format === "csv";
  const { data } = await apiClient.get<
    ReportResponse<BudgetVsActualRow[]> | Blob
  >(
    isCsv
      ? "/v1/reports/budget-vs-actual.csv"
      : "/v1/reports/budget-vs-actual",
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

export default function useBudgetVsActual<
  R = ReportResponse<BudgetVsActualRow[]>,
>(
  params: ReportFilters = {},
  options?: Omit<
    UseQueryOptions<ReportResponse<BudgetVsActualRow[]>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.budgetVsActual(params),
    queryFn: () => getBudgetVsActual(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
