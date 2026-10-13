import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";
import type { FundGoalTransactionRequest, FundGoalTransactionResponse } from "./types";

const useFundGoalTransaction = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: FundGoalTransactionRequest) =>
      api.post<FundGoalTransactionResponse>(`/v1/goals/${goalKey}/fund-transaction`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: goalActivityListQueryKey(goalKey) });
    },
  });
};

export default useFundGoalTransaction;
