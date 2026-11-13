import { useMutation } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import type { BudgetVisibility } from "@/lib/budget/visibility";

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
  /** Chosen once, here: the budget cannot change it later. Defaults to `household`. */
  visibility?: BudgetVisibility;
}

export interface BudgetCreateResponse {
  budgetKey: number;
}

export type BudgetCreateClient = Pick<AxiosInstance, "post">;

export function createBudget(
  {
    houseHoldSize,
    dependentsNum,
    incomes,
    visibility = "household",
  }: BudgetCreateRequest,
  apiClient: BudgetCreateClient = api,
) {
  return apiClient.post<BudgetCreateResponse>(`/v1/budget`, {
    houseHoldSize,
    dependentsNum,
    incomes,
    visibility,
  });
}

const useCreateBudget = () => {
  return useMutation({
    mutationFn: (request: BudgetCreateRequest) => createBudget(request),
  });
};

export default useCreateBudget;
