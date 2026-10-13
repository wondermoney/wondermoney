import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface TransactionEditRequest {
  transactionIds: (string | number)[];
  categoryId?: string | number;
  reviewed?: boolean;
  hidden?: boolean;
}

const useEditTransactions = () => {
  return useMutation({
    mutationFn: ({
      transactionIds,
      categoryId,
      reviewed,
      hidden,
    }: TransactionEditRequest) =>
      api.patch(`/v1/account/transaction`, {
        categoryId,
        transactionIds,
        reviewed,
        hidden,
      }),
  });
};

export default useEditTransactions;
