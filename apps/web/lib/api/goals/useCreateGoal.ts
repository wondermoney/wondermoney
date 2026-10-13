import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { goalsQueryKey } from "./keys";
import type { CreateGoalRequest, CreateGoalResponse } from "./types";

const useCreateGoal = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateGoalRequest) => api.post<CreateGoalResponse>("/v1/goals", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalsQueryKey });
    },
  });
};

export default useCreateGoal;
