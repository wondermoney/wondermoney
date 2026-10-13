import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface BudgetDeleteRequest {
  budgetKey: string | number;
}

const useDeleteBudget = () => {
  return useMutation({
    mutationFn: ({ budgetKey }: BudgetDeleteRequest) =>
      api.delete(`/v1/budget/${budgetKey}`),
  });
};

export default useDeleteBudget;
