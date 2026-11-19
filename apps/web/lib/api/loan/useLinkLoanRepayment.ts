import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { invalidateSecuredAssets } from "./secured-assets";
import type { LinkLoanRepaymentRequest } from "./types";

export interface LinkLoanRepaymentMutationRequest {
  loanId: number | string;
  payload: LinkLoanRepaymentRequest;
}

export function linkLoanRepayment({
  loanId,
  payload: { transactionKey, ...allocation },
}: LinkLoanRepaymentMutationRequest) {
  return api.post(`/v1/loan/${loanId}/repayments/link`, allocation, {
    params: { transactionKey },
  });
}

const useLinkLoanRepayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: linkLoanRepayment,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["loans", "overview"] });
      queryClient.invalidateQueries({ queryKey: ["loan", variables.loanId] });
      queryClient.invalidateQueries({
        queryKey: ["loan", variables.loanId, "repayments"],
      });
      queryClient.invalidateQueries({
        queryKey: ["loan", variables.loanId, "repayment-candidates"],
      });
      queryClient.invalidateQueries({ queryKey: ["net-worth"] });
      void invalidateSecuredAssets(queryClient);
    },
  });
};

export default useLinkLoanRepayment;
