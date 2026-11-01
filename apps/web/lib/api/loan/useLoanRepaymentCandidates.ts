import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type {
  LoanRepaymentCandidate,
  LoanRepaymentCandidatesFilters,
} from "./types";

export interface GetLoanRepaymentCandidatesResponse {
  candidates: LoanRepaymentCandidate[];
}

async function getLoanRepaymentCandidates(
  loanId: number | string,
  filters: LoanRepaymentCandidatesFilters = {},
  apiClient: AxiosInstance = api,
): Promise<GetLoanRepaymentCandidatesResponse> {
  const { data } = await apiClient.get<GetLoanRepaymentCandidatesResponse>(
    `/v1/loan/${loanId}/repayment-candidates`,
    { params: filters },
  );
  return data;
}

export default function useLoanRepaymentCandidates<
  R = GetLoanRepaymentCandidatesResponse,
>(
  loanId: number | string,
  filters: LoanRepaymentCandidatesFilters = {},
  options?: Omit<
    UseQueryOptions<GetLoanRepaymentCandidatesResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["loan", loanId, "repayment-candidates", filters],
    queryFn: () => getLoanRepaymentCandidates(loanId, filters),
    enabled: loanId !== undefined && loanId !== null,
    ...options,
  });
}
