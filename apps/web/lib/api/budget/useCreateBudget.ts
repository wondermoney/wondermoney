import { useMutation } from "@tanstack/react-query";

import api from "../api";

interface Income {
  name: string;
  amount: number;
  isRecurrent: boolean;
  recurrency?: string;
}

export interface BudgetCreateRequest {
  houseHoldSize: number;
  dependentsNum: number;
  incomes: Income[];
}

const useCreateBudget = () => {
  return useMutation({
    mutationFn: ({
      houseHoldSize,
      dependentsNum,
      incomes,
    }: BudgetCreateRequest) =>
      api.post(`/v1/budget`, { houseHoldSize, dependentsNum, incomes }),
  });
};

export default useCreateBudget;
