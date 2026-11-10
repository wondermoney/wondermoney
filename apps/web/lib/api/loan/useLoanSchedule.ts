import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { LoanSchedule } from "./types";

export interface GetLoanScheduleResponse {
  schedule: LoanSchedule;
}

async function getLoanSchedule(
  loanId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetLoanScheduleResponse> {
  const { data } = await apiClient.get<GetLoanScheduleResponse>(
    `/v1/loan/${loanId}/schedule`,
  );
  return data;
}

export default function useLoanSchedule<R = GetLoanScheduleResponse>(
  loanId: number | string,
  options?: Omit<
    UseQueryOptions<GetLoanScheduleResponse, Error, R>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["loan", loanId, "schedule"],
    queryFn: () => getLoanSchedule(loanId),
    enabled: loanId !== undefined && loanId !== null,
    ...options,
  });
}
