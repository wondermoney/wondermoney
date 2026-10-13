import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface TransactionEditRequest {
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
    }: TransactionEditRequest) =>
      api.patch(`/v1/account/transaction/${transactionKey}`, {
        categoryKey,
        updatedAmount,
      }),
  });
};

export default useEditTransaction;
