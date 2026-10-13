import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { availableToAssignQueryKey, goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";
import type { AssignGoalMoneyRequest } from "./types";

const useAssignGoalMoney = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AssignGoalMoneyRequest) => api.post(`/v1/goals/${goalKey}/assign`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: goalActivityListQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: availableToAssignQueryKey });
    },
  });
};

export default useAssignGoalMoney;
