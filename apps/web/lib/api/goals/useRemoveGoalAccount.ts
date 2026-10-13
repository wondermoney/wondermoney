import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";
import type { GoalAccountRequest } from "./types";

const useRemoveGoalAccount = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ accountKey }: GoalAccountRequest) =>
      api.delete(`/v1/goals/${goalKey}/accounts/${accountKey}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({
        queryKey: goalActivityListQueryKey(goalKey),
      });
    },
  });
};

export default useRemoveGoalAccount;
