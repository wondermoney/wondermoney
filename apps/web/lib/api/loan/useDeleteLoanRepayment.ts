import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";

export interface DeleteLoanRepaymentMutationRequest {
  loanId: number | string;
  repaymentLinkId: number | string;
}

const useDeleteLoanRepayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      loanId,
      repaymentLinkId,
    }: DeleteLoanRepaymentMutationRequest) =>
      api.delete(`/v1/loan/${loanId}/repayments/${repaymentLinkId}`),
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

export default useDeleteLoanRepayment;
