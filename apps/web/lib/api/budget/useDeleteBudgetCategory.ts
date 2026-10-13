import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface BudgetCategoryDeleteRequest {
  budgetKey: string | number;
  categoryKey: string | number;
  year: number;
  month: number;
}

const useDeleteBudgetCategory = () => {
  return useMutation({
    mutationFn: ({
      budgetKey,
      categoryKey,
      year,
      month,
    }: BudgetCategoryDeleteRequest) =>
      api.delete(`/v1/budget/${budgetKey}/${year}/${month}/${categoryKey}`),
  });
};

export default useDeleteBudgetCategory;
