import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface RemoveCategoryFromBudgetRequest {
  budgetKey: string | number;
  categoryKey: string | number;
  deletePreviousMonths?: boolean; // Default: false (only deletes from current month onwards)
}

const useRemoveCategoryFromBudget = () => {
  return useMutation({
    mutationFn: ({
      budgetKey,
      categoryKey,
      deletePreviousMonths = false,
    }: RemoveCategoryFromBudgetRequest) => {
      return api.delete(`/v1/budget/${budgetKey}/category/${categoryKey}`, {
        params: { deletePreviousMonths },
      });
    },
  });
};

export default useRemoveCategoryFromBudget;
