import { useMutation } from "@tanstack/react-query";

import api from "../api";

/**
 * A bulk change: the rows are `transactionIds`, or `filter` — every row the
 * list's filters match (`transactionSelectionFilter`), at most 5,000. Exactly
 * one of the two.
 */
export interface TransactionEditRequest {
  transactionIds?: (string | number)[];
  filter?: Record<string, string | boolean>;
  categoryId?: string | number;
  reviewed?: boolean;
  hidden?: boolean;
  addTagIds?: number[];
  removeTagIds?: number[];
}

const useEditTransactions = () => {
  return useMutation({
    mutationFn: ({
      transactionIds,
      filter,
      categoryId,
      reviewed,
      hidden,
      addTagIds,
      removeTagIds,
    }: TransactionEditRequest) =>
      api.patch(`/v1/account/transaction`, {
        categoryId,
        transactionIds,
        filter,
        reviewed,
        hidden,
        addTagIds,
        removeTagIds,
      }),
  });
};

export default useEditTransactions;
