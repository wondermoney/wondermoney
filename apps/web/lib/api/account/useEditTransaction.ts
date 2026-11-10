import { useMutation } from "@tanstack/react-query";

import type { TransferEdit } from "@/lib/account/transaction-transfer";

import api from "../api";

export interface TransactionEditRequest extends TransferEdit {
  transactionKey: number;
  categoryKey?: string;
  updatedAmount?: number;
}

const useEditTransaction = () => {
  return useMutation({
    mutationFn: ({
      transactionKey,
      categoryKey,
      updatedAmount,
      transactionType,
      transferDestination,
    }: TransactionEditRequest) =>
      api.patch(`/v1/account/transaction/${transactionKey}`, {
        categoryKey,
        updatedAmount,
        transactionType,
        transferDestination,
      }),
  });
};

export default useEditTransaction;
