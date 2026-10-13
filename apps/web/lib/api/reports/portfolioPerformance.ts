import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { reportsKeys } from "./keys";
import type {
  PortfolioPerformanceRow,
  ReportFilters,
  ReportFormat,
  ReportResponse,
} from "./types";

export interface GetPortfolioPerformanceRequest extends ReportFilters {
  /** Response format. `csv` downloads a Blob (`responseType: "blob"`). */
  format?: ReportFormat;
}

/**
 * Fetches per-account portfolio period performance.
 * Can be used in both Server Components and Client Components.
 *
 * @param params - Filter envelope; pass `format: "csv"` to download a Blob
 * @param apiClient - Optional Axios instance. Defaults to client-side API.
 */
export async function getPortfolioPerformance(
  params: GetPortfolioPerformanceRequest & { format: "csv" },
  apiClient?: AxiosInstance,
): Promise<Blob>;
export async function getPortfolioPerformance(
  params?: GetPortfolioPerformanceRequest,
  apiClient?: AxiosInstance,
): Promise<ReportResponse<PortfolioPerformanceRow[]>>;
export async function getPortfolioPerformance(
  params: GetPortfolioPerformanceRequest = {},
  apiClient: AxiosInstance = api,
): Promise<ReportResponse<PortfolioPerformanceRow[]> | Blob> {
  const { format, ...filters } = params;
  const isCsv = format === "csv";
  const { data } = await apiClient.get<
    ReportResponse<PortfolioPerformanceRow[]> | Blob
  >(
    isCsv
      ? "/v1/reports/portfolio-performance.csv"
      : "/v1/reports/portfolio-performance",
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

export default function usePortfolioPerformance<
  R = ReportResponse<PortfolioPerformanceRow[]>,
>(
  params: ReportFilters = {},
  options?: Omit<
    UseQueryOptions<ReportResponse<PortfolioPerformanceRow[]>, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: reportsKeys.portfolioPerformance(params),
    queryFn: () => getPortfolioPerformance(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}
