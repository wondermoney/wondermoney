import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { LoanRepayment } from "./types";

export interface GetLoanRepaymentsResponse {
  repayments: LoanRepayment[];
}

export async function getLoanRepayments(
  loanId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetLoanRepaymentsResponse> {
  const { data } = await apiClient.get<GetLoanRepaymentsResponse>(
    `/v1/loan/${loanId}/repayments`,
  );
  return data;
}

export default function useLoanRepayments<R = GetLoanRepaymentsResponse>(
  loanId: number | string,
  options?: Omit<
    UseQueryOptions<GetLoanRepaymentsResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["loan", loanId, "repayments"],
    queryFn: () => getLoanRepayments(loanId),
    enabled: loanId !== undefined && loanId !== null,
    ...options,
  });
}
