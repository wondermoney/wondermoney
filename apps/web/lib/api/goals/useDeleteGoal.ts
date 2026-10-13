import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { goalActivityListQueryKey, goalQueryKey, goalsQueryKey } from "./keys";

const useDeleteGoal = (goalKey: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/v1/goals/${goalKey}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
      queryClient.invalidateQueries({ queryKey: goalQueryKey(goalKey) });
      queryClient.invalidateQueries({ queryKey: goalActivityListQueryKey(goalKey) });
    },
  });
};

export default useDeleteGoal;
