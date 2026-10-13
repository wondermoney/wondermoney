import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import type { UpdateLoanRepaymentRequest } from "./types";

export interface UpdateLoanRepaymentMutationRequest {
  loanId: number | string;
  repaymentLinkId: number | string;
  payload: UpdateLoanRepaymentRequest;
}

const useUpdateLoanRepayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      loanId,
      repaymentLinkId,
      payload,
    }: UpdateLoanRepaymentMutationRequest) =>
      api.patch(`/v1/loan/${loanId}/repayments/${repaymentLinkId}`, payload),
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

export default useUpdateLoanRepayment;
