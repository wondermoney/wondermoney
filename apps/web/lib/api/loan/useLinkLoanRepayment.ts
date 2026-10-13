import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import type { LinkLoanRepaymentRequest } from "./types";

export interface LinkLoanRepaymentMutationRequest {
  loanId: number | string;
  payload: LinkLoanRepaymentRequest;
}

const useLinkLoanRepayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ loanId, payload }: LinkLoanRepaymentMutationRequest) =>
      api.post(`/v1/loan/${loanId}/repayments/link`, payload),
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
    },
  });
};

export default useLinkLoanRepayment;
