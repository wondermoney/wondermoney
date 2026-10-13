import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";
import type { UpdateGoalRequest, UpdateGoalResponse } from "./types";

const useUpdateGoal = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateGoalRequest) =>
      api.patch<UpdateGoalResponse>(`/v1/goals/${goalKey}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: goalActivityListQueryKey(goalKey) });
    },
  });
};

export default useUpdateGoal;
