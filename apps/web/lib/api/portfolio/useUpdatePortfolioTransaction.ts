import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { getPortfolioTransactionMutationInvalidationKeys } from "./portfolioInvalidation";

interface UpdateTransactionRequest {
  portfolioId: number;
  transactionId: number;
  body: {
    quantity?: number;
    unitPrice?: number;
    transactionDate?: string;
    financialTransactionTypeId?: string;
    settlementCurrencyId?: string;
    brokerId?: number | null;
    feeAmount?: number | null;
    feeCurrencyId?: string | null;
    originalUnitPrice?: number | null;
    originalCurrencyId?: string | null;
    notes?: string | null;
  };
}

const useUpdatePortfolioTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ portfolioId, transactionId, body }: UpdateTransactionRequest) =>
      api.put(`/v1/portfolio/${portfolioId}/transaction/${transactionId}`, body),
    onSuccess: (_data, variables) => {
      for (const queryKey of getPortfolioTransactionMutationInvalidationKeys(variables.portfolioId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export default useUpdatePortfolioTransaction;
