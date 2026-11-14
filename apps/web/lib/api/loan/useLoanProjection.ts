import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { LoanProjection, LoanProjectionFilters } from "./types";

export interface GetLoanProjectionResponse {
  projection: LoanProjection;
}

async function getLoanProjection(
  loanId: number | string,
  filters: LoanProjectionFilters = {},
  apiClient: AxiosInstance = api,
): Promise<GetLoanProjectionResponse> {
  const { data } = await apiClient.get<GetLoanProjectionResponse>(
    `/v1/loan/${loanId}/projection`,
    { params: filters },
  );
  return data;
}

export default function useLoanProjection<R = GetLoanProjectionResponse>(
  loanId: number | string,
  filters: LoanProjectionFilters = {},
  options?: Omit<
    UseQueryOptions<GetLoanProjectionResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["loan", loanId, "projection", filters],
    queryFn: () => getLoanProjection(loanId, filters),
    enabled: loanId !== undefined && loanId !== null,
    ...options,
  });
}
