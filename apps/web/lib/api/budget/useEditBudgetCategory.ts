import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface BudgetEditRequest {
  budgetKey: string | number;
  categoryKey: string | number;
  year: number;
  month: number;
  amount?: number;
  recurrency?: string;
  /** With `applyToFollowingMonths` (default true) it applies to every later stored month too. */
  rolloverEnabled?: boolean;
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
      rolloverEnabled,
    }: BudgetEditRequest) =>
      api.patch(`/v1/budget/${budgetKey}/${year}/${month}/${categoryKey}`, {
        amount,
        recurrency,
        applyToFollowingMonths,
        rolloverEnabled,
      }),
  });
};

export default useEditBudgetCategory;
