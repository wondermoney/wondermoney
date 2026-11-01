import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import { goalActivityQueryKey } from "./keys";
import type { GetGoalActivityResponse, GoalActivityParams } from "./types";

async function getGoalActivity(
  goalKey: number,
  params?: GoalActivityParams,
  apiClient: AxiosInstance = api,
): Promise<GetGoalActivityResponse> {
  const { data } = await apiClient.get<GetGoalActivityResponse>(`/v1/goals/${goalKey}/activity`, {
    params,
  });
  return data;
}

export default function useGoalActivity<R = GetGoalActivityResponse>(
  goalKey: number,
  params?: GoalActivityParams,
  options?: Omit<UseQueryOptions<GetGoalActivityResponse, Error, R>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: goalActivityQueryKey(goalKey, params),
    queryFn: () => getGoalActivity(goalKey, params),
    ...options,
  });
}
