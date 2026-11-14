import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { invalidateSecuredAssets } from "./secured-assets";
import type {
  LoanAdjustment,
  LoanAdjustmentRequest,
  LoanRatePeriod,
  LoanRatePeriodRequest,
} from "./types";

/**
 * A loan's balance adjustments and rate changes. Both reshape the outstanding balance, the
 * schedule and the projection, so a change refreshes the whole loan and the totals it feeds.
 */

export interface GetLoanAdjustmentsResponse {
  adjustments: LoanAdjustment[];
}

export interface GetLoanRatePeriodsResponse {
  ratePeriods: LoanRatePeriod[];
}

export async function getLoanAdjustments(
  loanId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetLoanAdjustmentsResponse> {
  const { data } = await apiClient.get<GetLoanAdjustmentsResponse>(
    `/v1/loan/${loanId}/adjustments`,
  );
  return data;
}

export async function getLoanRatePeriods(
  loanId: number | string,
  apiClient: AxiosInstance = api,
): Promise<GetLoanRatePeriodsResponse> {
  const { data } = await apiClient.get<GetLoanRatePeriodsResponse>(
    `/v1/loan/${loanId}/rate-periods`,
  );
  return data;
}

export function useLoanAdjustments(loanId: number | string) {
  return useQuery({
    queryKey: ["loan", loanId, "adjustments"],
    queryFn: () => getLoanAdjustments(loanId),
  });
}

export function useLoanRatePeriods(loanId: number | string) {
  return useQuery({
    queryKey: ["loan", loanId, "rate-periods"],
    queryFn: () => getLoanRatePeriods(loanId),
  });
}

function useLoanHistoryMutations<Body>(
  loanId: number | string,
  resource: "adjustments" | "rate-periods",
) {
  const queryClient = useQueryClient();
  // `["loan", id]` covers the loan, its schedule, projection and this list; the
  // asset it is secured against shows its balance as debt.
  const onSuccess = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["loan", loanId] }),
      queryClient.invalidateQueries({ queryKey: ["loans"] }),
      queryClient.invalidateQueries({ queryKey: ["net-worth"] }),
      invalidateSecuredAssets(queryClient),
    ]);
  const path = `/v1/loan/${loanId}/${resource}`;

  return {
    create: useMutation({
      mutationFn: (body: Body) => api.post(path, body),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ key, body }: { key: number; body: Partial<Body> }) =>
        api.patch(`${path}/${key}`, body),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (key: number) => api.delete(`${path}/${key}`),
      onSuccess,
    }),
  };
}

export function useLoanAdjustmentMutations(loanId: number | string) {
  return useLoanHistoryMutations<LoanAdjustmentRequest>(loanId, "adjustments");
}

export function useLoanRateMutations(loanId: number | string) {
  return useLoanHistoryMutations<LoanRatePeriodRequest>(loanId, "rate-periods");
}
