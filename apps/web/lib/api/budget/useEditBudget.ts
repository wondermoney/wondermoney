import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface BudgetEditRequest {
  budgetKey: string | number;
  name: string;
  description?: string;
}

const useEditBudget = () => {
  return useMutation({
    mutationFn: ({ budgetKey, name, description }: BudgetEditRequest) =>
      api.patch(`/v1/budget/${budgetKey}`, { name, description }),
  });
};

export default useEditBudget;
