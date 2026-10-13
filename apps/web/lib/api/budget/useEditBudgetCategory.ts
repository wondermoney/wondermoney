import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface BudgetEditRequest {
  budgetKey: string | number;
  categoryKey: string | number;
  year: number;
  month: number;
  amount?: number;
  recurrency?: string;
  applyToFollowingMonths?: boolean;
}

const useEditBudgetCategory = () => {
  return useMutation({
    mutationFn: ({
      budgetKey,
      categoryKey,
      year,
      month,
      amount,
      recurrency,
      applyToFollowingMonths,
    }: BudgetEditRequest) =>
      api.patch(`/v1/budget/${budgetKey}/${year}/${month}/${categoryKey}`, {
        amount,
        recurrency,
        applyToFollowingMonths,
      }),
  });
};

export default useEditBudgetCategory;
