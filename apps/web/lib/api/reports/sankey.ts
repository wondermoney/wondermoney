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
  SankeyData,
} from "./types";

export interface GetSankeyRequest extends ReportFilters {
  /** Response format. `csv` downloads a Blob (`responseType: "blob"`). */
  format?: ReportFormat;
}

/**
 * Fetches the cash-flow Sankey graph (income → category → account).
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Filter envelope; pass `format: "csv"` to download a Blob
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getSankey(
  params: GetSankeyRequest & { format: "csv" },
  apiClient?: AxiosInstance,
): Promise<Blob>;
export async function getSankey(
  params?: GetSankeyRequest,
  apiClient?: AxiosInstance,
): Promise<ReportResponse<SankeyData>>;
export async function getSankey(
  params: GetSankeyRequest = {},
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<SankeyData> | Blob> {
  const { format, ...filters } = params;
  const isCsv = format === "csv";
  const { data } = await apiClient.get<ReportResponse<SankeyData> | Blob>(
    isCsv ? "/v1/reports/sankey.csv" : "/v1/reports/sankey",
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

export default function useSankey<R = ReportResponse<SankeyData>>(
  params: ReportFilters = {},
  options?: Omit<
    UseQueryOptions<ReportResponse<SankeyData>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.sankey(params),
    queryFn: () => getSankey(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
