import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { availableToAssignQueryKey, goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";
import type { MoveGoalMoneyOutRequest } from "./types";

const useMoveGoalMoneyOut = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: MoveGoalMoneyOutRequest) => api.post(`/v1/goals/${goalKey}/move-out`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: goalActivityListQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: availableToAssignQueryKey });
    },
  });
};

export default useMoveGoalMoneyOut;
