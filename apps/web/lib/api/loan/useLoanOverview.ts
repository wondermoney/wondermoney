import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { LoanOverview } from "./types";

export interface GetLoanOverviewResponse {
  overview: LoanOverview;
}

export async function getLoanOverview(
  apiClient: AxiosInstance = api,
): Promise<GetLoanOverviewResponse> {
  const { data } =
    await apiClient.get<GetLoanOverviewResponse>("/v1/loan/overview");
  return data;
}

export default function useLoanOverview<R = GetLoanOverviewResponse>(
  options?: Omit<
    UseQueryOptions<GetLoanOverviewResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["loans", "overview"],
    queryFn: () => getLoanOverview(),
    ...options,
  });
}
