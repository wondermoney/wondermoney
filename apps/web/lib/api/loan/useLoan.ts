import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { LoanDetail } from "./types";

export interface GetLoanResponse {
  loan: LoanDetail;
}

async function getLoan(
  loanId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetLoanResponse> {
  const { data } = await apiClient.get<GetLoanResponse>(`/v1/loan/${loanId}`);
  return data;
}

export default function useLoan<R = GetLoanResponse>(
  loanId: number | string,
  options?: Omit<
    UseQueryOptions<GetLoanResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["loan", loanId],
    queryFn: () => getLoan(loanId),
    enabled: loanId !== undefined && loanId !== null,
    ...options,
  });
}
