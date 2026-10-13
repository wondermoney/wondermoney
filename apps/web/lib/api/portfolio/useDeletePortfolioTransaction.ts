import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { getPortfolioTransactionMutationInvalidationKeys } from "./portfolioInvalidation";

const useDeletePortfolioTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ portfolioId, transactionId }: { portfolioId: number; transactionId: number }) =>
      api.delete(`/v1/portfolio/${portfolioId}/transaction/${transactionId}`),
    onSuccess: (_data, variables) => {
      for (const queryKey of getPortfolioTransactionMutationInvalidationKeys(variables.portfolioId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export default useDeletePortfolioTransaction;
