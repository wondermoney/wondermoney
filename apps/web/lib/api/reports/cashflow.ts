import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { reportsKeys } from "./keys";
import type {
  CashflowPoint,
  ReportFilters,
  ReportFormat,
  ReportResponse,
} from "./types";

export interface GetCashflowRequest extends ReportFilters {
  /** Response format. `csv` downloads a Blob (`responseType: "blob"`). */
  format?: ReportFormat;
}

/**
 * Fetches the monthly income/expense/net cashflow series.
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Filter envelope; pass `format: "csv"` to download a Blob
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getCashflow(
  params: GetCashflowRequest & { format: "csv" },
  apiClient?: AxiosInstance,
): Promise<Blob>;
export async function getCashflow(
  params?: GetCashflowRequest,
  apiClient?: AxiosInstance,
): Promise<ReportResponse<CashflowPoint[]>>;
export async function getCashflow(
  params: GetCashflowRequest = {},
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<CashflowPoint[]> | Blob> {
  const { format, ...filters } = params;
  const isCsv = format === "csv";
  const { data } = await apiClient.get<ReportResponse<CashflowPoint[]> | Blob>(
    isCsv ? "/v1/reports/cashflow.csv" : "/v1/reports/cashflow",
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

export default function useCashflow<R = ReportResponse<CashflowPoint[]>>(
  params: ReportFilters = {},
  options?: Omit<
    UseQueryOptions<ReportResponse<CashflowPoint[]>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.cashflow(params),
    queryFn: () => getCashflow(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
