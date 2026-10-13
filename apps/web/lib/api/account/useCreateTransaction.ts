import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface CreateTransactionRequest {
  transactionDate: Date;
  transactionTypeId: string;
  accountId: string;
  description?: string;
  notes?: string;
  originalAmount?: string;
  originalCurrencyId?: string;
  exchangeRate?: string;
  settlementAmount: string;
  settlementCurrencyId: string;
  transactionMerchantId?: number;
  transactionMerchantName: string;
  categoryId?: number;
}

const useCreateTransaction = () => {
  return useMutation({
    mutationFn: ({
      transactionDate,
      transactionTypeId,
      accountId,
      description,
      notes,
      originalAmount,
      originalCurrencyId,
      exchangeRate,
      settlementAmount,
      settlementCurrencyId,
      transactionMerchantId,
      transactionMerchantName,
      categoryId,
    }: CreateTransactionRequest) =>
      api.post(`/v1/account/${accountId}/transaction`, {
        transactionDate,
        transactionTypeId,
        description,
        notes,
        originalAmount,
        originalCurrencyId,
        exchangeRate,
        settlementAmount,
        settlementCurrencyId,
        transactionMerchantId,
        transactionMerchantName,
        categoryId,
      }),
  });
};

export default useCreateTransaction;
