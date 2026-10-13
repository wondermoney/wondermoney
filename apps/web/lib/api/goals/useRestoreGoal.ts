import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";

const useRestoreGoal = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post(`/v1/goals/${goalKey}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: goalActivityListQueryKey(goalKey) });
    },
  });
};

export default useRestoreGoal;
