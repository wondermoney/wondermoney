import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface BudgetAddCategoryRequest {
  budgetKey: string | number;
  categoryKey: string | number;
  amountBudgeted: number;
  recurrency: string;
}

const useAddBudgetCategory = () => {
  return useMutation({
    mutationFn: ({
      budgetKey,
      categoryKey,
      amountBudgeted,
      recurrency,
    }: BudgetAddCategoryRequest) =>
      api.post(`/v1/budget/${budgetKey}/category`, {
        categoryKey,
        amountBudgeted,
        recurrency,
      }),
  });
};

export default useAddBudgetCategory;
