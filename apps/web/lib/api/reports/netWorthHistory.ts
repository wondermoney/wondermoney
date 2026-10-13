import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { reportsKeys } from "./keys";
import type {
  NetWorthPoint,
  ReportFilters,
  ReportFormat,
  ReportResponse,
} from "./types";

export interface GetNetWorthHistoryRequest extends ReportFilters {
  /** Response format. `csv` downloads a Blob (`responseType: "blob"`). */
  format?: ReportFormat;
}

/**
 * Fetches the net-worth history series (recompute-on-demand).
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Filter envelope; pass `format: "csv"` to download a Blob
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getNetWorthHistory(
  params: GetNetWorthHistoryRequest & { format: "csv" },
  apiClient?: AxiosInstance,
): Promise<Blob>;
export async function getNetWorthHistory(
  params?: GetNetWorthHistoryRequest,
  apiClient?: AxiosInstance,
): Promise<ReportResponse<NetWorthPoint[]>>;
export async function getNetWorthHistory(
  params: GetNetWorthHistoryRequest = {},
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<NetWorthPoint[]> | Blob> {
  const { format, ...filters } = params;
  const isCsv = format === "csv";
  const { data } = await apiClient.get<
    ReportResponse<NetWorthPoint[]> | Blob
  >(
    isCsv
      ? "/v1/reports/net-worth-history.csv"
      : "/v1/reports/net-worth-history",
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

export default function useNetWorthHistory<
  R = ReportResponse<NetWorthPoint[]>,
>(
  params: ReportFilters = {},
  options?: Omit<
    UseQueryOptions<ReportResponse<NetWorthPoint[]>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.netWorthHistory(params),
    queryFn: () => getNetWorthHistory(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
