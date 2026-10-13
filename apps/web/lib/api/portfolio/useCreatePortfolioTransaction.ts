import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { getPortfolioTransactionMutationInvalidationKeys } from "./portfolioInvalidation";

interface CreatePortfolioTransactionRequest {
  portfolioId: string;
  quantity: number;
  unitPrice: number;
  settlementCurrencyId: string;
  brokerId?: number;
  financialTransactionTypeId: string;
  transactionDate: Date;
  assetSymbol: string;
  feeAmount?: number;
  feeCurrencyId?: string;
  originalUnitPrice?: number;
  originalCurrencyId?: string;
  notes?: string;
  taxExempt?: boolean;
}

const useCreatePortfolioTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreatePortfolioTransactionRequest) => {
      const { portfolioId, ...rest } = params;
      return api.post(`/v1/portfolio/${portfolioId}/transaction`, rest);
    },
    onSuccess: (_data, variables) => {
      // Await (and return) every invalidation so the mutation genuinely
      // isn't "done" until each affected query has been marked stale and
      // an active refetch has been kicked off — a fire-and-forget loop here
      // let invalidateQueries() rejections vanish silently and gave callers
      // no way to know refetching had actually started.
      return Promise.all(
        getPortfolioTransactionMutationInvalidationKeys(
          Number(variables.portfolioId),
        ).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });
};

export default useCreatePortfolioTransaction;
