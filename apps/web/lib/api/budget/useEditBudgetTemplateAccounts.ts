import { useMutation } from "@tanstack/react-query";

import api from "../api";

export interface BudgetTemplateAccountsEditRequest {
  budgetKey: string | number;
  accountKeys: number[];
}

const useEditBudgetTemplateAccounts = () => {
  return useMutation({
    mutationFn: ({
      budgetKey,
      accountKeys,
    }: BudgetTemplateAccountsEditRequest) =>
      api.patch(`/v1/budget/${budgetKey}/accounts`, {
        accountKeys,
      }),
  });
};

export default useEditBudgetTemplateAccounts;
