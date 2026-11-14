import { useMutation } from "@tanstack/react-query";

import api from "../api";

/**
 * Send at least one of `name`, `periodStartDay` and `rolloverCarriesOverspend`.
 * When `name` is sent the API replaces `description` too (absent clears it).
 */
export interface BudgetEditRequest {
  budgetKey: string | number;
  name?: string;
  description?: string;
  /** The day of the month a budget month starts on, 1 to 28. */
  periodStartDay?: number;
  rolloverCarriesOverspend?: boolean;
}

const useEditBudget = () => {
  return useMutation({
    mutationFn: ({
      budgetKey,
      name,
      description,
      periodStartDay,
      rolloverCarriesOverspend,
    }: BudgetEditRequest) =>
      api.patch(`/v1/budget/${budgetKey}`, {
        name,
        description,
        periodStartDay,
        rolloverCarriesOverspend,
      }),
  });
};

export default useEditBudget;
