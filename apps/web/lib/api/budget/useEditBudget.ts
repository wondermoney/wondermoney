import { useMutation } from "@tanstack/react-query";

import api from "../api";

/**
 * Send at least one of `name` and `rolloverCarriesOverspend`. When `name` is
 * sent the API replaces `description` too (absent clears it).
 */
export interface BudgetEditRequest {
  budgetKey: string | number;
  name?: string;
  description?: string;
  rolloverCarriesOverspend?: boolean;
}

const useEditBudget = () => {
  return useMutation({
    mutationFn: ({
      budgetKey,
      name,
      description,
      rolloverCarriesOverspend,
    }: BudgetEditRequest) =>
      api.patch(`/v1/budget/${budgetKey}`, {
        name,
        description,
        rolloverCarriesOverspend,
      }),
  });
};

export default useEditBudget;
