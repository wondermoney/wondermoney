import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";
import type { GoalAccountRequest } from "./types";

const useAssignGoalAccount = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: GoalAccountRequest) => api.post(`/v1/goals/${goalKey}/accounts`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: goalActivityListQueryKey(goalKey) });
    },
  });
};

export default useAssignGoalAccount;
