import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import type { UpdateLoanRequest } from "./types";

export interface UpdateLoanMutationRequest {
  loanId: number | string;
  payload: UpdateLoanRequest;
}

const useUpdateLoan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ loanId, payload }: UpdateLoanMutationRequest) =>
      api.patch(`/v1/loan/${loanId}`, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["loans", "overview"] });
      queryClient.invalidateQueries({ queryKey: ["loan", variables.loanId] });
      queryClient.invalidateQueries({ queryKey: ["net-worth"] });
    },
  });
};

export default useUpdateLoan;
